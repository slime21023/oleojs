# Node.js

```ts
import { createServer } from 'node:http'
import { toNodeListener } from 'oleojs/node'
import app from './app.ts'

const env = { db: await openDatabase() }

createServer(toNodeListener(app, { env })).listen(3000)
```

- **Requests:** the application receives a lightweight `Request` stand-in by default. Most code cannot tell the difference, but `new Request(request, init)` and `fetch(request)` need a native request; see [Performance](#performance).
- **Responses:** any `Response` works. On Node, prefer [`FastResponse`](#fastresponse), which the adapter writes without a body stream.
- **HTTP/2:** works with the `node:http2` compatibility API (`createSecureServer`) and with `node:https`.
- **Proxies:** `trustProxy: true` uses the first `X-Forwarded-Proto` and `X-Forwarded-Host` for the request URL. Enable it only behind a proxy that always sets or strips these headers.
- **Request bodies:** a body that the application does not read, or cancels (for example through `bodyLimit`), is discarded after the response. The response still arrives, and HTTP/1.1 keep-alive connections remain usable.
- **Disconnects:** `request.signal` aborts when the client goes away before the response finishes.
- `waitUntil` uses the stub. Server startup, TLS, and graceful shutdown belong to the application.

## Performance

Building and reading native `Request` and `Response` objects is most of the adapter's cost per request. The adapter therefore passes a lightweight request by default, and offers `FastResponse` for responses:

```ts
import { createServer } from 'node:http'
import { get, router, toFetch } from 'oleojs'
import { FastResponse, toNodeListener } from 'oleojs/node'

const routes = router(
  get('/users/:id', (_request, ctx) => FastResponse.json({ id: ctx.params.id })),
)

createServer(toNodeListener(toFetch(routes))).listen(3000)
```

On the [benchmark](https://github.com/slime21023/oleojs/tree/main/bench) (Node.js 24, short text and JSON messages), the defaults with `FastResponse` served 1.2 to 1.4 times the requests per second of Express 5, the defaults with `Response` 0.8 to 1.1 times, and `lazyRequest: false` with `Response` 0.7 to 0.9 times. Results vary between runs and machines; measure your own application.

### Lightweight requests (`lazyRequest`, default `true`)

- **What changes:** the application receives a stand-in for `Request`. `method`, `url`, and `signal` are plain values, and `headers` is built on first read. `text()`, `json()`, `arrayBuffer()`, and `bytes()` read the body straight from Node's request, without a Web stream, and mark it used as a native request would. The first use of any other member, such as `body`, `formData()`, or `clone()`, builds the native `Request` once and delegates to it.
- **Same results:** `url` and `method` are normalized as the `Request` constructor would normalize them, and requests it would reject still get `400`. Generated tests compare both against `new Request`.
- **Limits:** the stand-in passes `instanceof Request`, but it has no native internal slots. These throw a `TypeError`:
  - `new Request(request, init)`. Build the new request from its members instead: `new Request(request.url, { method: request.method, headers: request.headers, body, signal: request.signal })`. The standard filters already do.
  - `fetch(request)`, for example in a proxy. Pass `request.clone()`, which is a native `Request`.
  - Native `Request.prototype` methods called with the stand-in as `this`.
- **Headers:** headers read before the native request exists are an ordinary mutable `Headers` object; later reads return the native request's headers, which include those changes.
- **Native requests:** `toNodeListener(app, { lazyRequest: false })` passes a native `Request` instead, for code that relies on `new Request(request, init)` or `fetch(request)`.

### `FastResponse`

- **What changes:** `new FastResponse(body, init)` and `FastResponse.json(data, init)` take the same arguments as `Response`, validate them the same way, and are typed as `Response`. For a string, `Uint8Array`, or `null` body, the adapter writes status, headers, `Content-Length`, and body in one `end()` call, with no body stream.
- **Same results:** `status`, `statusText`, `ok`, and `headers` are plain reads. Using any other member, such as `body`, `text()`, or `clone()`, builds the native `Response` once, and the adapter then writes it like any other response. Filters that rebuild responses, such as `cors` and `responseHeaders`, therefore keep working.
- **Limits:** only `oleojs/node` recognizes it, so code meant for other runtimes should keep using `Response`. It passes `instanceof Response` but has no native internal slots: native `Response.prototype` methods called with it as `this` throw a `TypeError`. Other bodies, such as streams, use the normal streaming path.

## Adapter reference

### API

```ts
type NodeListenerOptions<E = unknown> =
  { readonly trustProxy?: boolean /* default false */; readonly lazyRequest?: boolean /* default true */ }
  & (undefined extends E ? { readonly env?: E } : { readonly env: E })
type NodeListenerArgs<E> = undefined extends E ? [options?: NodeListenerOptions<E>] : [options: NodeListenerOptions<E>]

type NodeRequest = IncomingMessage | Http2ServerRequest
type NodeResponse = ServerResponse | Http2ServerResponse
type NodeListener = (req: NodeRequest, res: NodeResponse) => void

function toNodeListener<E>(app: FetchHandler<E>, ...args: NodeListenerArgs<E>): NodeListener

const FastResponse: {
  new (body?: BodyInit | null, init?: ResponseInit): Response
  readonly prototype: Response
  json(data: unknown, init?: ResponseInit): Response
}
```

The implementation is in `src/node/listener.ts`, with the stand-ins in `src/node/request.ts` and `src/node/response.ts`; `src/node/index.ts` re-exports `toNodeListener`, `FastResponse`, and these types.

```ts
createServer(toNodeListener(toFetch(app), { env })).listen(3000)
```

- **Any `{ fetch }` object.** The listener accepts any object with a `fetch` method, not only the output of `toFetch`. It calls `app.fetch(request, options.env, stub)`.
- **`env` is required when the app needs one**, matching [`FetchArgs`](/runtimes/#entry-point): `toNodeListener(app)` is a type error for a `FetchHandler<Env>`.
- **The user owns the server.** Creating it, listening, TLS, and shutdown are the user's concern. The listener works with `node:http`, `node:https`, and the `node:http2` compatibility API.

### Ingress: `IncomingMessage` / `Http2ServerRequest` → `Request`

Both request modes apply the same rules. A lightweight request computes the URL and method as below and normalizes them as the `Request` constructor would; with `lazyRequest: false`, the constructor itself does.


- **URL:**
  - **Scheme:** `https` when the socket is TLS, or `:scheme` on HTTP/2.
  - **Host:** from `Host` or `:authority`.
  - **Proxy headers:** when `trustProxy` is `true`, the first value of `X-Forwarded-Proto` (only `http` or `https`) and of `X-Forwarded-Host` override the scheme and host. Otherwise they are ignored.
- **Host validation (security):** the host is joined into the URL string, and Node's parser does not validate it. A host that is missing, or that contains `/`, `\`, `?`, `#`, `@`, or whitespace, gets `400`. Otherwise `Host: evil.test/admin` would reroute `/x` to `/admin/x`. The same check applies to `X-Forwarded-Host`.
- **Request target:**
  - Origin-form (`/path?query`) is joined with the scheme and host.
  - Absolute-form (`http://host/path`) is used as-is: RFC 9112 says it overrides `Host`.
  - Any other form (such as `OPTIONS *`) is rejected as by the `Request` constructor and gets `400`.
- **Headers:** built from `rawHeaders` using `append`, so duplicates are preserved. HTTP/2 pseudo-headers are stripped. A lightweight request builds them on first read.
- **Body:** `null` for `GET` and `HEAD`. Otherwise a Web stream that reads `Readable.toWeb(req)`, with `duplex: 'half'`. A lightweight request creates it only when `body` or another native member is used; `text()`, `json()`, `arrayBuffer()`, and `bytes()` read Node's request directly, and also fail instead of truncating when the body is discarded after the response.
  - **Cancellation discards, never destroys.** Canceling `Readable.toWeb` directly destroys the request mid-message. A response sent after the cancel (such as a `bodyLimit` 413) is then lost, or the keep-alive connection stalls. Canceling the adapter's stream instead reads and drops the remainder, as Node does for unread bodies.
  - **After the response,** an incomplete body is discarded the same way, because the Web stream consumes the request and Node no longer discards it itself. This keeps HTTP/1.1 connections reusable. A handler still reading after its response has finished gets a stream error instead of a silently truncated body.
- **Abort:** an `AbortController` aborts when the connection closes before the response finishes. Its `signal` is the request's `signal`.
- **Construction failures:** the adapter responds directly, without calling `app.fetch`.
  - **`501 Not Implemented`:** a method Fetch forbids (`CONNECT`, `TRACE`, `TRACK`). This is checked before construction, with the list shared through `src/http-method.ts`.
  - **`400 Bad Request`:** an invalid host, or any other request the `Request` constructor rejects, such as an unsupported request target or a URL with credentials. Node's HTTP parser already rejects invalid header values; with `lazyRequest: false`, the constructor checks them too.
- **Context:** `env` comes from `options.env`, and `executionCtx` is the stub.

### Egress: `Response` → `ServerResponse` / `Http2ServerResponse`

- **Head:** `writeHead(status, statusText, headers)`. Multiple `Set-Cookie` values are written via `headers.getSetCookie()`. On HTTP/2, `Connection`, `Keep-Alive`, `Transfer-Encoding`, and `Upgrade` are dropped.
- **Body:** a reader loop writes each chunk with `serverRes.write()` and waits for `drain` when Node's buffer is full, so a client that stops reading stops the body from being pulled. This avoids the per-response cost of `Readable.fromWeb` and `stream.pipeline`. An error destroys the socket. A client abort cancels the web stream, which also ends a pending read or `drain` wait. A `null` body ends immediately, and `HEAD` writes no body.
- **`FastResponse`:** an unread `FastResponse` with a string, `Uint8Array`, or `null` body is written with one `end()` call. A Content-Type default and `Content-Length` are added unless its headers set them; `HEAD` writes the headers only. See [Performance options](#performance).
- **Cancellation failures:** `HEAD` cleanup finishes before headers are sent, so failure is reported and returns 500. Cancellation after a disconnect, whether the response arrived late or was mid-stream, is also awaited and reported on failure; the adapter never writes to an already destroyed response.
- **No buffering** in either direction.

### Client disconnects

- **Signalling:** the `Request`'s `signal` aborts whenever the response closes before it ends.
- **Late responses:** if the app's response arrives after the client is gone, its body is cancelled and nothing is written.
- **Not errors:** a disconnect stops the body copy without an error. It is not reported; only body read errors and cancellation failures count as server errors.
- **Do not classify by `signal.aborted`.** A failing response body also destroys the response, which aborts the signal.

### Other runtimes

Bun and Deno implement `node:http`, and the built adapter has been observed working on both. This is not a supported target; those runtimes should use their native `{ fetch }` entry.

