# Request and response transformations

Use `mapRequest((request, ctx) => ...)` to pass a transformed request downstream, or `mapResponse((response, request, ctx) => ...)` to transform a returned response. Both accept synchronous or asynchronous callbacks and propagate errors. They preserve the context; a response callback sees the context at its filter's position, so a filter outside the router does not gain route parameters afterwards.

For static response headers, `responseHeaders(headers)` handles copying and reconstruction:

```ts
import { get, router, toFetch, withFilters } from 'oleojs'
import { mapRequest, responseHeaders } from 'oleojs/filters'

const routes = router(get('/language', (request) =>
  new Response(request.headers.get('Accept-Language')),
))

const app = withFilters(routes,
  mapRequest((request) => {
    const headers = new Headers(request.headers)
    if (!headers.has('Accept-Language')) headers.set('Accept-Language', 'en')
    return new Request(request.url, { method: request.method, headers, signal: request.signal })
  }),
  responseHeaders({ 'Cache-Control': 'no-store', 'X-Service': 'oleo' }),
)

export default toFetch(app)
```

The new request is built from the incoming request's members, which works on every runtime. `new Request(request, init)` would also copy the body, but it accepts only native requests, and the Node adapter passes a [lightweight request](/runtimes/node#performance) by default. To forward a body, read it first, for example with `await request.arrayBuffer()`, and pass it as `body`.

`responseHeaders` accepts a native `Headers`, header record, or array of header pairs. It snapshots the configuration, replaces matching names, and preserves other headers, repeated `Set-Cookie` values, status, and the streaming body. Status-zero responses pass through unchanged. Transform callbacks own any body reading and should return new messages when making changes.

Callbacks can use an environment inferred from the surrounding router/group or a typed handler passed to `withFilters`. For a separately declared transform, annotate `ctx: Context<Env>` or use the exported `RequestTransform<Env>` / `ResponseTransform<Env>` types.


These helpers are exported from `oleojs/filters`. They follow the same portable API and native-message preservation rules as standard filters.

## `mapRequest(transform)` and `mapResponse(transform)`

```ts
type RequestTransform<E = unknown> = (req: Request, ctx: Context<E>) => Request | Promise<Request>
type ResponseTransform<E = unknown> =
  (response: Response, req: Request, ctx: Context<E>) => Response | Promise<Response>

function mapRequest<E = unknown>(transform: RequestTransform<E>): HttpFilter<E>
function mapResponse<E = unknown>(transform: ResponseTransform<E>): HttpFilter<E>
```

- A transform must be a function; invalid options throw `TypeError` when the factory is called.
- `mapRequest` awaits the callback and passes its returned Request to the next handler with the same context. A callback failure skips the next handler.
- `mapResponse` awaits the next handler before invoking the callback. A downstream failure skips the callback. Its returned Response becomes the filter's result.
- Both synchronous throws and promise rejections propagate to outer filters. These helpers do not render errors or isolate callbacks as logging filters do.
- Callbacks receive the request and context visible at their filter's position. A response transform outside the router does not see route parameters or context keys added downstream. A group transform runs after routing and sees the matched parameters.
- Context is preserved, including symbol-keyed values. Callback parameter types use `Context<E>`; route-specific parameter inference on the wrapped handler remains intact.
- Helpers do not inspect or buffer bodies. Any reading or replacement belongs to the callback, which must respect native stream ownership and return new messages when making changes.

## `responseHeaders(headers)`

```ts
function responseHeaders<E = unknown>(headers: HeadersInit): HttpFilter<E>
```

- Accepts a native Headers instance, a record, or header pairs. Configuration is validated and copied through `new Headers(headers)` when the factory is called; missing or invalid inputs throw `TypeError`.
- Configured names replace existing values case-insensitively. Other headers are preserved. Repeated Set-Cookie values remain separate, including when replacing an existing set of cookies.
- Each response receives a separate Headers copy and a new Response retaining status, status text, and body. The original headers and configured input are not modified; later caller mutations do not affect the filter.
- Bodies remain streaming and are not read or buffered. Null bodies remain null, including HEAD, 204, and 304 responses.
- Status-zero responses pass through unchanged because native Response constructors cannot recreate network-error or opaque responses.
- This helper changes headers only; it does not recompute representation metadata. Callers choose header values appropriate to their body.

Example, with the first filter outermost:

```ts
const app = withFilters(routes,
  mapRequest(addRequestHeaders),
  responseHeaders({ 'Cache-Control': 'no-store' }),
  mapResponse(transformResponse),
)
```


