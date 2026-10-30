# Running oleo.js on each runtime

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

## Cloudflare Workers

```ts
import app from './app.ts'

export default app
```

- Workers passes your bindings as `env` and its own `ExecutionContext`. `ctx.executionCtx.waitUntil(promise)` extends the request lifetime natively.
- Declare `Env` to match your `wrangler` bindings. The runtime, not your code, supplies it.

## Deno

```ts
import app from './app.ts'

const env = { db: await openDatabase() }

Deno.serve({ port: 8000 }, (request) => app.fetch(request, env))
```

- For an application without an environment, `Deno.serve(app.fetch)` works directly, because `fetch` does not depend on `this`.
- Deno has no `ExecutionContext`. `waitUntil` uses the oleo.js stub: background promises keep running while the process lives, rejections are reported with `console.error`, and the request lifetime is not extended.

## Bun

```ts
import app from './app.ts'

const env = { db: await openDatabase() }

Bun.serve({ port: 3000, fetch: (request) => app.fetch(request, env) })
```

- For an application without an environment, `export default app` or `Bun.serve({ fetch: app.fetch })` works directly.
- `waitUntil` uses the same stub as on Deno.

## Node.js

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

## On every runtime

- **Tests** need no runtime or adapter. Call `await app.fetch(new Request('https://test/users/1'), env)`.
- **Body limits:** install `bodyLimit({ maxBytes })` inside `problemDetails()` on every runtime. Some hosts also enforce their own limits, but `bodyLimit` behaves the same everywhere.
- **Background work:** only Workers extends a request with `waitUntil`. On Deno, Bun, and Node.js, keep track of background work you need to finish before shutdown.
