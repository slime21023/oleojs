# oleo.js

A zero-runtime-dependency HTTP router and middleware library for TypeScript. Build applications from functions, compose request handling explicitly, and work with native Web `Request` and `Response` objects.

The portable core runs on Cloudflare Workers, Deno, and Bun. A separate adapter connects it to Node.js HTTP servers.

## Design philosophy

- **An application is a function.** A handler takes a `Request` and a `Context`, then returns a `Response` or a promise of one. Routers are handlers too, so routing and middleware share the same composition model.
- **Use native Web primitives.** Requests, responses, headers, and streams keep their native behavior. Context holds request data; responses are created with `new Response()` or `Response.json()`.
- **Make data flow explicit.** Routes and groups are immutable values. Middleware passes data downstream through derived contexts, while typed context keys let independent modules share values without name collisions.
- **Keep platform boundaries clear.** The core uses ECMAScript and the WinterTC Minimum Common Web API. Runtime-specific integration belongs in adapters; applications own server startup, configuration, and shutdown.
- **Keep the API small and predictable.** Route parameters and environments carry their types through composition. Invalid route definitions fail when the router is constructed. Routing is prepared once, balancing efficient request handling with readable, maintainable code.

## Quick start

Create an application in `app.ts`:

```ts
import { get, group, router, toFetch } from 'oleo.js'

const routes = router(
  get('/health', () => new Response('ok')),
  group('/users/:userId',
    get('/posts/:postId', (_request, ctx) => Response.json({
      userId: ctx.params.userId,
      postId: ctx.params.postId,
    })),
  ),
)

export default toFetch(routes)
```

The nested route matches `/users/42/posts/7`. Both parameter names are inferred from the patterns, including the group prefix.

Call the application directly to exercise it without starting a server:

```ts
import app from './app.ts'

const response = await app.fetch(
  new Request('https://example.test/users/42/posts/7'),
)

console.log(await response.json()) // { userId: '42', postId: '7' }
```

## Available modules

The package exposes four entry points: `oleo.js`, `oleo.js/filters`, `oleo.js/contract`, and `oleo.js/node`.

| Module | Public API | Purpose |
| --- | --- | --- |
| Routing | `router`, `get`, `post`, `put`, `patch`, `del`, `head`, `options`, `route` | Define method-and-path routes with inferred parameters. Use `route` for custom HTTP methods. |
| Route groups | `group`, `RouteGroup`, `GroupOptions` | Share path prefixes and middleware across nested routes. |
| Middleware composition | `withFilters`, `compose`, `HttpFilter`, `HttpHandler` | Apply filters in one call or build a reusable stack, combining their environment requirements. |
| Typed context | `contextKey`, `ContextKey`, `Context` | Pass typed values, environment data, and route parameters through request handling. |
| Fetch entry point | `toFetch`, `FetchHandler`, `ExecutionContext` | Create a per-request context and expose a callable `fetch` entry point. |
| Route types | `Route`, `Params`, `ParamsOf` | Describe route values and type handlers declared separately from their routes. |
| CORS | `cors`, `CorsOptions` from `oleo.js/filters` | Apply an explicit origin policy, handle preflights, and add response headers. |
| Bearer authentication | `bearerAuth`, `BearerAuthOptions` from `oleo.js/filters` | Verify tokens through application code and optionally store a typed principal. |
| Problem details | `problemDetails`, `Problem`, `ProblemDetailsOptions` from `oleo.js/filters` | Convert thrown errors and empty error responses into problem documents. |
| Request logging | `requestLogger`, `LogEntry`, `RequestLoggerOptions` from `oleo.js/filters` | Record the request outcome and duration, with optional application fields. |
| Request/response transformations | `mapRequest`, `mapResponse`, `responseHeaders` from `oleo.js/filters` | Transform messages with synchronous or asynchronous callbacks, or set response headers. |
| Contracts | `contract`, `toOpenApi` from `oleo.js/contract` | Validate inputs with application-owned schemas, infer their outputs, and generate OpenAPI 3.1.1 from the same routes. |
| Node.js adapter | `toNodeListener` from `oleo.js/node` | Bridge Node.js HTTP/1.1 and HTTP/2 compatibility servers to Web requests and responses, including streaming and disconnect handling. |

Routing, composition, context, and Fetch APIs are exported from `oleo.js`. Filters, contracts, and the Node.js adapter have their own entry points.

### Routing and groups

Patterns support static segments, named parameters such as `/users/:id`, and a terminal wildcard such as `/files/*`. Parameters are decoded after matching; a wildcard value is available as `ctx.params['*']`.

- Static segments take priority over parameters, which take priority over wildcards. Matching also considers the request method.
- Case and trailing slashes are significant. `/users` and `/users/` are distinct routes.
- An unmatched path returns `404`. A matching path with an unsupported method returns `405` with an `Allow` header.
- `HEAD` can fall back to `GET`, and its response has no body. `OPTIONS` routes are explicit.
- Invalid patterns, conflicting route definitions, and invalid methods are rejected when `router()` is called.

Groups combine prefixes with their nested routes. A route with an empty pattern, such as `get('', handler)`, addresses the group prefix itself. Group middleware is supplied through `group(prefix, { filters: [...] }, ...routes)` and runs only for matched routes, with their parameters available. Unmatched requests skip group middleware.

### Middleware and context keys

A filter wraps a handler. `withFilters(handler, a, b)` applies filters in one call and means `a(b(handler))`: the first filter is outermost. Use `compose(a, b)` when you want to reuse that stack with several handlers.

```ts
import { contextKey, get, router, toFetch, withFilters } from 'oleo.js'
import type { HttpFilter } from 'oleo.js'

const requestIdKey = contextKey<string>('request-id')

const identifyRequest: HttpFilter = (next) => (request, ctx) =>
  next(request, requestIdKey.with(ctx, crypto.randomUUID()))

const routes = router(
  get('/', (_request, ctx) => Response.json({
    requestId: requestIdKey.get(ctx),
  })),
)

export default toFetch(withFilters(routes, identifyRequest))
```

`with` creates a derived context. `get` requires the value to be present and throws if it is missing; `find` returns `undefined` when absent. Values survive the context derivation performed by routing.

Filters can return early, handle errors, or transform a response. To change response headers, copy the headers and construct a new `Response`. Keep incoming requests and responses unchanged.

Environment requirements combine automatically. If `needsDb` is an `HttpFilter<DbEnv>` and `needsCache` is an `HttpFilter<CacheEnv>`, `compose(needsDb, needsCache)` returns an `HttpFilter<DbEnv & CacheEnv>`. `withFilters(handler, needsDb, needsCache)` also retains any environment requirements and route parameters of the handler. A handler can use only part of that environment; callers supply the combined requirements.

### Standard filters

All four standard filters are available from `oleo.js/filters`. They compose with custom filters and preserve handler environment and route-parameter types.

```ts
import { contextKey, get, group, router, toFetch, withFilters } from 'oleo.js'
import { bearerAuth, cors, problemDetails, requestLogger } from 'oleo.js/filters'

interface User { id: string }
interface Env { verifyToken(token: string): Promise<User | undefined> }

const userKey = contextKey<User>('user')
const routes = router<Env>(
  group('/api', {
    filters: [bearerAuth({
      verify: (token, _request, ctx) => ctx.env.verifyToken(token),
      key: userKey,
      realm: 'api',
    })],
  }, get('/me', (_request, ctx) => Response.json(userKey.get(ctx)))),
)

const app = toFetch(withFilters(routes,
  requestLogger(),
  cors({ origin: 'https://app.example.com' }),
  problemDetails(),
))

export default app
```

Supply the application's `verifyToken` through `env`, as described under runtime integration below. The outer logger records the final status, CORS handles preflights before authentication, and problem details converts authentication and routing errors. CORS belongs around the whole router; group authentication runs only for matched routes.

- **CORS:** explicitly choose `'*'`, one serialized origin, an origin list, or a synchronous predicate. Configure methods, allowed/exposed headers, credentials, and preflight cache duration as needed. Credentials require an explicit origin policy rather than `'*'`. Allowed preflights return `204`; normal responses keep their body while receiving copied headers and merged `Vary` values. The policy follows the [Fetch CORS protocol](https://fetch.spec.whatwg.org/#http-cors-protocol).
- **Bearer authentication:** `verify` may be synchronous or asynchronous. Only `undefined` rejects a token; other values are valid principals. An optional context key stores that principal with its type checked against the verifier. Missing or rejected credentials return `401`; malformed Bearer credentials return `400`, with [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750.html) challenges. Verification errors propagate to the error filter.
- **Request logging:** the default writes one JSON entry with the method, raw path, status, and duration in milliseconds. Query strings are excluded, and timing ends when the handler returns a response. Customize `log(entry)` and synchronous `fields(request, response)` callbacks; additional fields cannot override core fields. Thrown errors are logged and rethrown. Logging failures are reported without changing the request outcome.

Each factory validates its options when called. Filters keep the package free of runtime dependencies.

### Request and response transformations

Use `mapRequest((request, ctx) => ...)` to pass a transformed request downstream, or `mapResponse((response, request, ctx) => ...)` to transform a returned response. Both accept synchronous or asynchronous callbacks and propagate errors. They preserve the context; a response callback sees the context at its filter's position, so a filter outside the router does not gain route parameters afterwards.

For static response headers, `responseHeaders(headers)` handles copying and reconstruction:

```ts
import { get, router, toFetch, withFilters } from 'oleo.js'
import { mapRequest, responseHeaders } from 'oleo.js/filters'

const routes = router(get('/language', (request) =>
  new Response(request.headers.get('Accept-Language')),
))

const app = withFilters(routes,
  mapRequest((request) => {
    const headers = new Headers(request.headers)
    if (!headers.has('Accept-Language')) headers.set('Accept-Language', 'en')
    return new Request(request, { headers })
  }),
  responseHeaders({ 'Cache-Control': 'no-store', 'X-Service': 'oleo' }),
)

export default toFetch(app)
```

`responseHeaders` accepts a native `Headers`, header record, or array of header pairs. It snapshots the configuration, replaces matching names, and preserves other headers, repeated `Set-Cookie` values, status, and the streaming body. Status-zero responses pass through unchanged. Transform callbacks own any body reading and should return new messages when making changes.

Callbacks can use an environment inferred from the surrounding router/group or a typed handler passed to `withFilters`. For a separately declared transform, annotate `ctx: Context<Env>` or use the exported `RequestTransform<Env>` / `ResponseTransform<Env>` types.

### Problem details

Wrap a router with `problemDetails()` to render errors as [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) problem documents:

```ts
import { get, router, toFetch } from 'oleo.js'
import { problemDetails } from 'oleo.js/filters'

const routes = router(get('/health', () => new Response('ok')))

export default toFetch(problemDetails()(routes))
```

An unknown path now returns a `404` response with `Content-Type: application/problem+json` and the document `{ "status": 404, "type": "about:blank", "title": "Not Found" }`. Thrown errors default to a generic `500` without exposing their messages or stacks.

- Use `fromError(error, request)` to synchronously map application errors to a `Problem` with an integer status from 400 through 599. Invalid mappings fall back to the generic 500.
- Use `emptyResponses: false` to disable conversion of existing empty error responses. Responses that already have a body, including an empty string, pass through unchanged.
- Use `onError(error, request)` to report thrown errors that become 5xx responses. The default is `console.error`; reporting failures do not change the response.

Generated HEAD responses remain bodyless. When an empty response is converted, its headers are copied, Content-Type is replaced, and stale Content-Length and Content-Encoding values are removed. Headers such as Allow and WWW-Authenticate are preserved.

### Environments and runtime integration

Use `router<Env>(...)` to make application environment data available as `ctx.env` with the expected type. For a direct call, supply that data as the second argument to `app.fetch(request, env)`. A hosting runtime may supply its own second argument, so its meaning depends on the integration.

`toFetch` returns an object whose `fetch` function can be called independently of the object. Export it for Cloudflare Workers or Bun, or pass `app.fetch` to `Deno.serve`. The `{ fetch }` shape and `ExecutionContext` are oleo.js conventions inspired by Workers, rather than WinterTC APIs.

On Node.js, connect the same application to a server:

```ts
import { createServer } from 'node:http'
import { toNodeListener } from 'oleo.js/node'
import app from './app.ts'

createServer(toNodeListener(app)).listen(3000)
```

The adapter also accepts an `env` option for application data. Server configuration and lifecycle remain under application control.

### Contracts and OpenAPI

`contract(definition, handler)` returns an ordinary Route. The handler receives `(request, ctx, input)`, where `input` contains only the declared sources, after validation and transformation. Schemas implement [Standard Schema](https://standardschema.dev/); the application chooses its validation library and rules.

```ts
import { group, router, toFetch } from 'oleo.js'
import { contract, toOpenApi } from 'oleo.js/contract'
import { limitSchema } from './project-schemas.ts'

const routes = group('/api', contract({
  method: 'GET',
  path: '/projects',
  operationId: 'listProjects',
  request: {
    query: { limit: { schema: limitSchema, required: false } },
  },
  responses: { 200: { description: 'Requested page size' } },
}, (_request, _ctx, { query }) => Response.json({ limit: query.limit })))

const document = toOpenApi({
  info: { title: 'Projects API', version: '1.0.0' },
}, routes)

export default toFetch(router(routes))
```

Here `limitSchema` turns an optional decimal string into a number, defaulting to 20. See the [complete list/create/authenticated-route example](docs/examples/contract.ts) and its [application-owned schemas](docs/examples/project-schemas.ts).

- Field failures produce `422` Problem Details containing an `errors` list. Invalid or missing JSON bodies produce `400`; unsupported or missing JSON media types produce `415`. Unexpected validator failures propagate to outer filters.
- `request.json` consumes the body once. Use `input.json` inside the handler. Raw `ctx.params` stay strings even when `input.params` contains converted values.
- `toOpenApi` reads definitions without invoking filters, handlers, or validators. It exports input/output JSON Schema through the schema's Standard JSON Schema capability or an application-supplied `toJsonSchema` callback. Missing export support is an error.
- OpenAPI includes applicable `400`/`415`/`422` response descriptions; explicit responses override those defaults. Ordinary routes can be mixed in and are omitted from the document.
- Response schemas describe documentation only: native responses and streaming bodies are not validated or read. Security metadata describes authentication; install `bearerAuth` or another filter to enforce it.

See the [Contract reference](docs/project-reference.md#contracts) for validation rules, document generation limits, and error shapes. Schema rules, rendering, and file-system conventions remain application responsibilities.

## Development

Use the Bun version pinned in `package.json` to install dependencies and run the project commands:

```sh
bun install
bun run lint
bun run typecheck
bun run test
bun run build
```

Tests use Vitest. All test cases live under `test/`: `portable/` for runtime-independent behavior, `node/` for adapter integration, and `types/` for type inference contracts. Property-based tests use fast-check to exercise generated inputs alongside example-based tests.

`bun run test` runs the portable and adapter tests on Node.js, plus type tests. `bun run test:all` runs the runtime matrix across Node.js, Bun, workerd, and Deno; run type tests separately with `bun run test:types` when using that matrix command.

See the [technical reference](docs/project-reference.md) for detailed API behavior, architecture, testing, and planned feature specifications. [AGENTS.md](AGENTS.md) records the project's core goals and architectural principles.

## License

[MIT](LICENSE).
