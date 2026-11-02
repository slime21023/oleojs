# `problemDetails(options?)`

Wrap a router with `problemDetails()` to render errors as [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) problem documents:

```ts
import { get, router, toFetch } from 'oleojs'
import { problemDetails } from 'oleojs/filters'

const routes = router(get('/health', () => new Response('ok')))

export default toFetch(problemDetails()(routes))
```

An unknown path now returns a `404` response with `Content-Type: application/problem+json` and the document `{ "status": 404, "type": "about:blank", "title": "Not Found" }`. Thrown errors default to a generic `500` without exposing their messages or stacks.

- Use `fromError(error, request)` to synchronously map application errors to a `Problem` with an integer status from 400 through 599. Invalid mappings fall back to the generic 500.
- Use `emptyResponses: false` to disable conversion of existing empty error responses. Responses that already have a body, including an empty string, pass through unchanged.
- Use `onError(error, request)` to report thrown errors that become 5xx responses. The default is `console.error`; reporting failures do not change the response.

Generated HEAD responses remain bodyless. When an empty response is converted, its headers are copied, Content-Type is replaced, and stale Content-Length and Content-Encoding values are removed. Headers such as Allow and WWW-Authenticate are preserved.


Implemented in [`src/filters/problem-details.ts`](https://github.com/slime21023/oleojs/blob/main/src/filters/problem-details.ts), following [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html).

```ts
interface Problem {
  readonly status: number            // 400–599
  readonly type?: string             // default 'about:blank'
  readonly title?: string            // default: the status's standard reason phrase
  readonly detail?: string
  readonly instance?: string
  readonly [extension: string]: unknown
}

interface ProblemDetailsOptions {
  fromError?: (error: unknown, req: Request) => Problem | undefined // undefined → default 500
  emptyResponses?: boolean                                        // default true
  onError?: (error: unknown, req: Request) => void                // default: console.error(error)
}

function problemDetails<E = unknown>(options?: ProblemDetailsOptions): HttpFilter<E>
```

- **Option validation:** options must be an object; `fromError` and `onError`, when supplied, must be functions, and `emptyResponses` must be a boolean. Invalid types throw `TypeError` when the factory is called.
- **Thrown errors:** `next` is awaited inside `try`/`catch`. A thrown value becomes `fromError?.(error, req)`, or the default `{ status: 500 }` when that returns `undefined`.
  - **Rendered as** `application/problem+json`.
  - **No leaks:** the default problem never includes `error.message` or a stack.
  - **Reporting:** `onError` runs for thrown errors that end up as a 5xx, with the original error and request. An empty 5xx response has no thrown error and does not trigger reporting.
  - **Reporting failures:** exceptions and returned promise rejections from `onError` are reported through `console.error` without changing the chosen response. Reporting promises do not delay the response or extend the request lifetime.
  - **Invalid mappings:** if `fromError` throws, returns a non-integer status or one outside 400–599, or produces an invalid/non-serializable problem, the result is the default 500 and `onError` receives the original error. Known text fields must be strings when supplied; a root `toJSON` method is rejected because it could override the document's status.
- **Empty error responses** (`emptyResponses: true`): a response with status ≥ 400 and a `null` body becomes a problem document with the same status and status text. Headers are copied, preserving `Allow`, `WWW-Authenticate`, CORS headers, and other fields. `Content-Type` is set to `application/problem+json`; stale `Content-Length` and `Content-Encoding` are removed because the representation has changed.
  - This covers the router's default 404/405/400 and `bearerAuth`'s 401/400.
  - A response with any body, even an empty string, is left alone. Handlers that return their own error bodies are never rewritten.
- **Generated `HEAD` responses never get a body.** For a `HEAD` request the status and headers are converted, and the body stays `null`. The router strips bodies from `HEAD` responses, so without this rule every `HEAD` 404 would gain a body.
- **Reason phrases:** ECMA-429 has no table of reason phrases, so `src/filters/` ships its own for registered error statuses through 511, based on the [IANA registry](https://www.iana.org/assignments/http-status-codes/). For an unused or unassigned status, `title` is omitted unless explicitly supplied.
- **Out of scope:** an error raised while a body is already streaming cannot be converted, because the headers are already sent.
- **No error class.** The package exports no throwable `HttpProblem`, since that would be a response builder in disguise (see [Non-goals](/guide/introduction#non-goals)). Map your own error types with `fromError`.

