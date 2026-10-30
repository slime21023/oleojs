# Node.js

```ts
import { createServer } from 'node:http'
import { toNodeListener } from 'oleo.js/node'
import app from './app.ts'

const env = { db: await openDatabase() }

createServer(toNodeListener(app, { env })).listen(3000)
```

- **HTTP/2:** works with the `node:http2` compatibility API (`createSecureServer`) and with `node:https`.
- **Proxies:** `trustProxy: true` uses the first `X-Forwarded-Proto` and `X-Forwarded-Host` for the request URL. Enable it only behind a proxy that always sets or strips these headers.
- **Request bodies:** a body that the application does not read, or cancels (for example through `bodyLimit`), is discarded after the response. The response still arrives, and HTTP/1.1 keep-alive connections remain usable.
- **Disconnects:** `request.signal` aborts when the client goes away before the response finishes.
- `waitUntil` uses the stub. Server startup, TLS, and graceful shutdown belong to the application.

## Adapter reference

### API

```ts
type NodeListenerOptions<E = unknown> =
  { readonly trustProxy?: boolean } // default false
  & (undefined extends E ? { readonly env?: E } : { readonly env: E })
type NodeListenerArgs<E> = undefined extends E ? [options?: NodeListenerOptions<E>] : [options: NodeListenerOptions<E>]

type NodeRequest = IncomingMessage | Http2ServerRequest
type NodeResponse = ServerResponse | Http2ServerResponse
type NodeListener = (req: NodeRequest, res: NodeResponse) => void

function toNodeListener<E>(app: FetchHandler<E>, ...args: NodeListenerArgs<E>): NodeListener
```

The implementation is in `src/node/listener.ts`; `src/node/index.ts` re-exports `toNodeListener` and these types.

```ts
createServer(toNodeListener(toFetch(app), { env })).listen(3000)
```

- **Any `{ fetch }` object.** The listener accepts any object with a `fetch` method, not only the output of `toFetch`. It calls `app.fetch(request, options.env, stub)`.
- **`env` is required when the app needs one**, matching [`FetchArgs`](/runtimes/#entry-point): `toNodeListener(app)` is a type error for a `FetchHandler<Env>`.
- **The user owns the server.** Creating it, listening, TLS, and shutdown are the user's concern. The listener works with `node:http`, `node:https`, and the `node:http2` compatibility API.

### Ingress: `IncomingMessage` / `Http2ServerRequest` → `Request`

- **URL:**
  - **Scheme:** `https` when the socket is TLS, or `:scheme` on HTTP/2.
  - **Host:** from `Host` or `:authority`.
  - **Proxy headers:** when `trustProxy` is `true`, the first value of `X-Forwarded-Proto` (only `http` or `https`) and of `X-Forwarded-Host` override the scheme and host. Otherwise they are ignored.
- **Host validation (security):** the host is joined into the URL string, and Node's parser does not validate it. A host that is missing, or that contains `/`, `\`, `?`, `#`, `@`, or whitespace, gets `400`. Otherwise `Host: evil.test/admin` would reroute `/x` to `/admin/x`. The same check applies to `X-Forwarded-Host`.
- **Request target:**
  - Origin-form (`/path?query`) is joined with the scheme and host.
  - Absolute-form (`http://host/path`) is used as-is: RFC 9112 says it overrides `Host`.
  - Any other form (such as `OPTIONS *`) fails `Request` construction and gets `400`.
- **Headers:** built from `rawHeaders` using `append`, so duplicates are preserved. HTTP/2 pseudo-headers are stripped.
- **Body:** `null` for `GET` and `HEAD`. Otherwise a Web stream that reads `Readable.toWeb(req)`, with `duplex: 'half'`.
  - **Cancellation discards, never destroys.** Canceling `Readable.toWeb` directly destroys the request mid-message. A response sent after the cancel (such as a `bodyLimit` 413) is then lost, or the keep-alive connection stalls. Canceling the adapter's stream instead reads and drops the remainder, as Node does for unread bodies.
  - **After the response,** an incomplete body is discarded the same way, because the Web stream consumes the request and Node no longer discards it itself. This keeps HTTP/1.1 connections reusable. A handler still reading after its response has finished gets a stream error instead of a silently truncated body.
- **Abort:** an `AbortController` aborts when the connection closes before the response finishes. Its `signal` is passed to the `Request`.
- **Construction failures:** the adapter responds directly, without calling `app.fetch`.
  - **`501 Not Implemented`:** a method Fetch forbids (`CONNECT`, `TRACE`, `TRACK`). This is checked before construction, with the list shared through `src/http-method.ts`.
  - **`400 Bad Request`:** an invalid host, or any other `new Request()` failure (an unsupported request target, an invalid header value).
- **Context:** `env` comes from `options.env`, and `executionCtx` is the stub.

### Egress: `Response` → `ServerResponse` / `Http2ServerResponse`

- **Head:** `writeHead(status, statusText, headers)`. Multiple `Set-Cookie` values are written via `headers.getSetCookie()`. On HTTP/2, `Connection`, `Keep-Alive`, `Transfer-Encoding`, and `Upgrade` are dropped.
- **Body:** `stream.pipeline(Readable.fromWeb(res.body), serverRes)`, which honors backpressure. An error destroys the socket. A client abort tears down the pipeline and cancels the web stream. A `null` body ends immediately, and `HEAD` writes no body.
- **Cancellation failures:** `HEAD` cleanup finishes before headers are sent, so failure is reported and returns 500. Cleanup of a late response is also awaited and reported on failure; the adapter never writes to an already destroyed response.
- **No buffering** in either direction.

### Client disconnects

- **Signalling:** the `Request`'s `signal` aborts whenever the response closes before it ends.
- **Late responses:** if the app's response arrives after the client is gone, its body is cancelled and nothing is written.
- **Not errors:** a disconnect surfaces in the pipeline as `ERR_STREAM_PREMATURE_CLOSE`. It is not reported, and only other pipeline errors count as server errors.
- **Do not classify by `signal.aborted`.** A failing response body also destroys the response, which aborts the signal.

### Other runtimes

Bun and Deno implement `node:http`, and the built adapter has been observed working on both. This is not a supported target; those runtimes should use their native `{ fetch }` entry.

