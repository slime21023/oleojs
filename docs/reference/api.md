# API overview


The package exposes four entry points: `oleo.js`, `oleo.js/filters`, `oleo.js/contract`, and `oleo.js/node`.

| Module | Public API | Purpose |
| --- | --- | --- |
| Routing | `router`, `get`, `post`, `put`, `patch`, `del`, `head`, `options`, `route` | Define method-and-path routes with inferred parameters. Use `route` for custom HTTP methods. |
| Route groups | `group`, `RouteGroup`, `GroupOptions` | Share path prefixes and middleware across nested routes. |
| Environment-bound helpers | `routesFor`, `RouteHelpers` | Bind route and group helpers to one environment for routes declared outside their router. |
| Middleware composition | `withFilters`, `compose`, `HttpFilter`, `HttpHandler` | Apply filters in one call or build a reusable stack, combining their environment requirements. |
| Typed context | `contextKey`, `ContextKey`, `Context` | Pass typed values, environment data, and route parameters through request handling. |
| Fetch entry point | `toFetch`, `FetchHandler`, `ExecutionContext` | Create a per-request context and expose a callable `fetch` entry point that requires the environment its handler needs. |
| Route types | `Route`, `RouteItem`, `Params`, `ParamsOf`, `JoinParams` | Describe route values and type handlers declared separately from their routes. |
| Extension API | `inspectRoutes`, `withRouteCheck`, `RouteEntry` | List routes as `router()` registers them and attach definition-time checks, for documentation and tooling packages. |
| CORS | `cors`, `CorsOptions` from `oleo.js/filters` | Apply an explicit origin policy, handle preflights, and add response headers. |
| Bearer authentication | `bearerAuth`, `BearerAuthOptions` from `oleo.js/filters` | Verify tokens through application code and optionally store a typed principal. |
| Problem details | `problemDetails`, `Problem`, `ProblemDetailsOptions` from `oleo.js/filters` | Convert thrown errors and empty error responses into problem documents. |
| Request logging | `requestLogger`, `LogEntry`, `RequestLoggerOptions` from `oleo.js/filters` | Record the request outcome and duration, with optional application fields. |
| Body size limit | `bodyLimit`, `BodyLimitOptions` from `oleo.js/filters` | Reject request bodies over a byte limit with `413` before handlers read them. |
| Request/response transformations | `mapRequest`, `mapResponse`, `responseHeaders` from `oleo.js/filters` | Transform messages with synchronous or asynchronous callbacks, or set response headers. |
| Contracts | `contract`, `contractFor`, `toOpenApi` from `oleo.js/contract` | Validate inputs with application-owned schemas, infer their outputs, and generate OpenAPI 3.1.1 from the same routes. |
| Node.js adapter | `toNodeListener`, `NodeListenerOptions` from `oleo.js/node` | Bridge Node.js HTTP/1.1 and HTTP/2 compatibility servers to Web requests and responses, including streaming and disconnect handling. |

Routing, composition, context, and Fetch APIs are exported from `oleo.js`. Filters, contracts, and the Node.js adapter have their own entry points.

## Core functions

An application is plain function composition. There is no application class and no mutable registration step.

```ts
import { router, get, post, del, toFetch, withFilters } from 'oleo.js'

const routes = router(
  get('/users/:id', (req, ctx) => Response.json({ id: ctx.params.id })),
  post('/users', createUser),
  del('/users/:id', requireAdmin(deleteUser)), // route-level filter: wrap the handler
)

// Application-provided filters; standard alternatives are exported from oleo.js/filters.
const app = withFilters(routes, logger(), requireAuth())

export default toFetch(app)
```

| Function | Returns | Notes |
| --- | --- | --- |
| `get`, `post`, `put`, `patch`, `del`, `head`, `options` `(pattern, handler)` | `Route` | `del` because `delete` is a reserved word |
| `route(method, pattern, handler)` | `Route` | Any other method (`PROPFIND`, …) |
| `router(...items)` | `HttpHandler` | Takes routes and groups. Builds the trie once. Throws on [route definition errors](/reference/routing#route-definition-errors) |
| `group(prefix, options?, ...items)` | `RouteGroup` | See [Route groups](/guide/groups) |
| `routesFor<E, TBase>()` | `RouteHelpers` | The helpers above bound to environment `E`, for routes declared outside their router. Same functions at runtime; see [Environment-bound helpers](/guide/groups#environment-bound-helpers) |
| `inspectRoutes(...items)` | `readonly RouteEntry[]` | The routes `router()` would register, with the same checks and errors; see [Extension API](/extending/) |
| `withRouteCheck(route, check)` | `Route` | A copy of `route` whose `check` runs at definition time; see [Extension API](/extending/) |
| `compose(...filters)` | `HttpFilter` | `compose(a, b)(h)` is `a(b(h))`: the first filter is outermost. `compose()` is the identity |
| `withFilters(handler, ...filters)` | `HttpHandler` | Applies the same outermost-first order in one call, retaining route parameters and combining environment requirements |
| `toFetch(handler)` | `FetchHandler` | The only entry point. Creates the `Context` |

- **Routes are values.** A `Route` is immutable, and `router()` reads it once. A router is itself an `HttpHandler`, so routers and filters nest freely.
- **Type inference.** Route patterns are parsed with template literal types: `'/users/:id/*'` yields `ctx.params: { id: string; '*': string }`. `router<E>(...)` fixes `E` for its routes, and route helpers infer `E` and `P` contextually.
- **Clients are handlers too.** Any `(req) => Promise<Response>` is assignable to `HttpHandler`. Do not pass `globalThis.fetch` itself as a handler: its second parameter is `RequestInit`, not `Context`. Wrap it as `(req) => fetch(req)`.

## Types

Exact declarations live in [`src/types.ts`](https://github.com/slime21023/oleo.js/blob/main/src/types.ts); public exports live in [`src/index.ts`](https://github.com/slime21023/oleo.js/blob/main/src/index.ts).

| Type | Contract |
| --- | --- |
| `Params` | `Readonly<Record<string, string>>` |
| `Context<E, P>` | Readonly `params`, `env`, and `executionCtx` fields; defaults are `E = unknown`, `P = Params` |
| `ExecutionContext` | oleo.js interface with `waitUntil(promise: Promise<unknown>): void` |
| `HttpHandler<E, P>` | `(req: Request, ctx: Context<E, P>) => Response \| Promise<Response>` |
| `HttpFilter<E>` | Wraps a handler; requires at least env `E`, preserving the handler's env and parameter types |
| `FetchHandler<E>` | A detachable `fetch(request, env?, executionCtx?)` returning `Promise<Response>` |
| `ParamsOf<TPattern>` | Exported for separately declared handlers; `'/users/:id/*'` yields readonly `id` and `'*'` strings; a non-literal `string` yields `Params` |

The [type inference contract](https://github.com/slime21023/oleo.js/blob/main/CONTRIBUTING.md#type-inference-contract) explains the required generic and phantom-member design.

