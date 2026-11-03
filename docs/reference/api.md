# API

## `oleojs`

| Export | Description |
| --- | --- |
| `get`, `post`, `put`, `patch`, `del`, `head`, `options` | `(pattern, handler)` creates a route for that method |
| `route(method, pattern, handler)` | Creates a route for any other method |
| `router(...routes)` | Creates a handler from routes and groups. Throws on invalid definitions |
| `group(prefix, options?, ...routes)` | Puts routes under a shared prefix. `options.filters` run for its routes only |
| `routesFor<Env>()` | The route helpers above, bound to an environment type, for routes in other modules |
| `withFilters(handler, ...filters)` | Wraps a handler with filters. The first filter is the outermost |
| `compose(...filters)` | Combines filters into one |
| `contextKey<T>(name)` | Creates a typed key with `with(ctx, value)`, `get(ctx)`, and `find(ctx)` |
| `toFetch(handler)` | Creates the `{ fetch(request, env?, executionCtx?) }` entry point |
| `inspectRoutes`, `withRouteCheck` | For tooling; see [Extension API](/reference/extending) |

### Types

| Type | Description |
| --- | --- |
| `HttpHandler<Env, Params>` | `(request, ctx) => Response \| Promise<Response>` |
| `HttpFilter<Env>` | `(next: HttpHandler) => HttpHandler` |
| `Context<Env, Params>` | `{ params, env, executionCtx }` |
| `ContextKey<T>` | The value `contextKey` returns |
| `FetchHandler<Env>` | The value `toFetch` returns |
| `ExecutionContext` | `{ waitUntil(promise) }` |
| `ParamsOf<'/users/:id'>` | The parameters of a pattern: `{ id: string }` |
| `Route`, `RouteGroup`, `RouteItem`, `GroupOptions`, `RouteHelpers`, `Params`, `JoinParams`, `RouteEntry` | Types of route values, for code that declares or inspects routes separately |

## `oleojs/filters`

| Export | Options type | Page |
| --- | --- | --- |
| `cors(options)` | `CorsOptions` | [CORS](/filters/cors) |
| `bearerAuth(options)` | `BearerAuthOptions` | [Bearer authentication](/filters/bearer-auth) |
| `problemDetails(options?)` | `ProblemDetailsOptions`, `Problem` | [Problem details](/filters/problem-details) |
| `requestLogger(options?)` | `RequestLoggerOptions`, `LogEntry` | [Request logging](/filters/request-logger) |
| `bodyLimit(options)` | `BodyLimitOptions` | [Body size limit](/filters/body-limit) |
| `mapRequest(fn)`, `mapResponse(fn)`, `responseHeaders(headers)` | `RequestTransform`, `ResponseTransform` | [Transformations](/filters/transforms) |

## `oleojs/contract`

| Export | Description |
| --- | --- |
| `contract(definition, handler)` | Creates a route that validates its input. See [Contracts](/contracts/) |
| `contractFor<Env>()` | `contract`, bound to an environment type |
| `toOpenApi(options, ...routes)` | Generates an OpenAPI 3.1.1 document. See [OpenAPI](/contracts/openapi) |

Types include `ContractDefinition`, `ContractRequest`, `ContractInput`, `OpenApiOptions`, `OpenApiDocument`, and the Standard Schema types `StandardSchemaV1` and `StandardResult`.

## `oleojs/node`

| Export | Description |
| --- | --- |
| `toNodeListener(app, options?)` | Creates a `node:http` request listener. See [Node.js](/runtimes/#node-js) |
| `FastResponse` | A `Response` the Node.js adapter writes directly |

Types: `NodeListenerOptions`, `NodeListener`, `NodeRequest`, `NodeResponse`.
