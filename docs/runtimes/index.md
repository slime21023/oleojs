# Runtimes

Use `router<Env>(...)` to make application environment data available as `ctx.env` with the expected type. For a direct call, supply that data as the second argument to `app.fetch(request, env)`. When the handler needs an environment, `env` is a required argument, so omitting it is a type error rather than a runtime crash. A handler whose environment may be `undefined` keeps it optional. A hosting runtime may supply its own second argument, so its meaning depends on the integration.

`toFetch` returns an object whose `fetch` function can be called independently of the object. The `{ fetch }` shape and `ExecutionContext` are oleo.js conventions inspired by Workers, rather than WinterTC APIs.

| Runtime | Application without env | Application with env |
| --- | --- | --- |
| Cloudflare Workers | `export default app` | `export default app` (Workers supplies `Env`) |
| Deno | `Deno.serve(app.fetch)` | `Deno.serve((request) => app.fetch(request, env))` |
| Bun | `export default app` | `Bun.serve({ fetch: (request) => app.fetch(request, env) })` |
| Node.js | `createServer(toNodeListener(app))` | `createServer(toNodeListener(app, { env }))` |

Deno and Bun pass their own server objects as the second argument, so an application that needs an environment must be wrapped. See the [runtime guide](/runtimes/) for `waitUntil` behavior, Node.js proxy and body handling, and background work on each runtime. Server configuration and lifecycle remain under application control.

An oleo.js application is a value with a `fetch` function:

```ts
// app.ts
import { router, toFetch } from 'oleo.js'
import { users } from './users.ts'

export interface Env {
  db: Database
}

export default toFetch(router<Env>(users))
```

`app.fetch(request, env, executionCtx?)` follows the Cloudflare Workers call shape. This shape and `ExecutionContext` are oleo.js conventions, not WinterTC APIs. The application code is the same everywhere. Each runtime differs only in what it passes as the second argument, and in whether it provides `waitUntil`.

| Runtime | Second argument passed by the runtime | Entry point for an app **without** env | Entry point for an app **with** env |
| --- | --- | --- | --- |
| Cloudflare Workers | your `Env` bindings | `export default app` | `export default app` |
| Deno | `ServeHandlerInfo` | `Deno.serve(app.fetch)` | `Deno.serve((request) => app.fetch(request, env))` |
| Bun | the `Server` | `export default app` | `Bun.serve({ fetch: (request) => app.fetch(request, env) })` |
| Node.js | (adapter) | `toNodeListener(app)` | `toNodeListener(app, { env })` |

When the application needs an environment, `app.fetch` and `toNodeListener` require it in their types. On Deno, `deno check` therefore rejects `Deno.serve(app.fetch)` for such an app, instead of letting `ctx.env` silently become the runtime's `ServeHandlerInfo`. Bun's `export default app` is not checked against the `fetch` signature, so on Bun an app that needs an environment must always use the explicit `Bun.serve` wrapper.

## Entry point

`toFetch(handler).fetch(request, ...args: FetchArgs<E>)` follows the Workers signature `(request, env, executionCtx?)`, and the returned object is directly usable as `export default`.

- **`fetch` must not depend on `this`.** Runtimes may call it detached (for example `Deno.serve(app.fetch)`), so it is a closure, not a method that reads `this`.

- **`env`:** whatever the runtime passes second becomes `ctx.env` (Workers `Env`, Bun `Server`, Deno `ServeHandlerInfo`).
- **Required when needed:** `FetchArgs<E>` makes `env` optional only when `undefined` is assignable to `E` (including `unknown`). For `toFetch(router<Env>(…))`, `app.fetch(request)` is a type error. On Bun and Deno, which pass their own second argument, wrap an application that needs an environment: `Deno.serve((request) => app.fetch(request, env))`. The [runtime guide](/runtimes/) lists every runtime's entry point and `waitUntil` behavior.
- **`executionCtx`:** when the runtime passes none, the stub is used.
- **Testing:** `toFetch(app).fetch(new Request('http://test/users/1'))` works with no network and no adapter. `env` is `undefined` and `executionCtx` is the stub.

## On every runtime

- **Tests** need no runtime or adapter. Call `await app.fetch(new Request('https://test/users/1'), env)`.
- **Body limits:** install `bodyLimit({ maxBytes })` inside `problemDetails()` on every runtime. Some hosts also enforce their own limits, but `bodyLimit` behaves the same everywhere.
- **Background work:** only Workers extends a request with `waitUntil`. On Deno, Bun, and Node.js, keep track of background work you need to finish before shutdown.
