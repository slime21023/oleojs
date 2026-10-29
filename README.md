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

The package currently exposes two entry points: `oleo.js` and `oleo.js/node`.

| Module | Public API | Purpose |
| --- | --- | --- |
| Routing | `router`, `get`, `post`, `put`, `patch`, `del`, `head`, `options`, `route` | Define method-and-path routes with inferred parameters. Use `route` for custom HTTP methods. |
| Route groups | `group`, `RouteGroup`, `GroupOptions` | Share path prefixes and middleware across nested routes. |
| Middleware composition | `compose`, `HttpFilter`, `HttpHandler` | Wrap handlers with reusable behavior in an explicit order. |
| Typed context | `contextKey`, `ContextKey`, `Context` | Pass typed values, environment data, and route parameters through request handling. |
| Fetch entry point | `toFetch`, `FetchHandler`, `ExecutionContext` | Create a per-request context and expose a callable `fetch` entry point. |
| Route types | `Route`, `Params`, `ParamsOf` | Describe route values and type handlers declared separately from their routes. |
| Node.js adapter | `toNodeListener` from `oleo.js/node` | Bridge Node.js HTTP/1.1 and HTTP/2 compatibility servers to Web requests and responses, including streaming and disconnect handling. |

All modules except the Node.js adapter are exported from `oleo.js`.

### Routing and groups

Patterns support static segments, named parameters such as `/users/:id`, and a terminal wildcard such as `/files/*`. Parameters are decoded after matching; a wildcard value is available as `ctx.params['*']`.

- Static segments take priority over parameters, which take priority over wildcards. Matching also considers the request method.
- Case and trailing slashes are significant. `/users` and `/users/` are distinct routes.
- An unmatched path returns `404`. A matching path with an unsupported method returns `405` with an `Allow` header.
- `HEAD` can fall back to `GET`, and its response has no body. `OPTIONS` routes are explicit.
- Invalid patterns, conflicting route definitions, and invalid methods are rejected when `router()` is called.

Groups combine prefixes with their nested routes. A route with an empty pattern, such as `get('', handler)`, addresses the group prefix itself. Group middleware is supplied through `group(prefix, { filters: [...] }, ...routes)` and runs only for matched routes, with their parameters available. Unmatched requests skip group middleware.

### Middleware and context keys

A filter wraps a handler. `compose(a, b)(handler)` means `a(b(handler))`: the first filter is outermost.

```ts
import { compose, contextKey, get, router, toFetch } from 'oleo.js'
import type { HttpFilter } from 'oleo.js'

const requestIdKey = contextKey<string>('request-id')

const identifyRequest: HttpFilter = (next) => (request, ctx) =>
  next(request, requestIdKey.with(ctx, crypto.randomUUID()))

const routes = router(
  get('/', (_request, ctx) => Response.json({
    requestId: requestIdKey.get(ctx),
  })),
)

export default toFetch(compose(identifyRequest)(routes))
```

`with` creates a derived context. `get` requires the value to be present and throws if it is missing; `find` returns `undefined` when absent. Values survive the context derivation performed by routing.

Filters can return early, handle errors, or transform a response. To change response headers, copy the headers and construct a new `Response`. Keep incoming requests and responses unchanged.

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

## Planned extensions

The routing core, route groups, middleware composition, context keys, Fetch entry point, and Node.js adapter are implemented.

The following entry points are planned and are **not currently implemented or exported**:

- **`oleo.js/filters`**: standard CORS, Bearer authentication, problem-details responses, and request logging filters. Their design is documented in the technical reference.
- **`oleo.js/contract`**: declarative contracts and OpenAPI generation. The API is not yet settled.

Application-specific validation, rendering, and file-system conventions remain application responsibilities.

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
