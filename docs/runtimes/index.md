# Runtimes

The same application runs everywhere. Write it once and export the result of `toFetch`:

```ts
// app.ts
import { get, router, toFetch } from 'oleojs'

export default toFetch(router(
  get('/', () => new Response('Hello!')),
))
```

Each runtime only needs a few lines to serve it.

## Cloudflare Workers

```ts
import app from './app.ts'

export default app
```

Workers passes your bindings as the environment, so `router<Env>()` handlers can read them from `ctx.env`. `ctx.executionCtx.waitUntil(promise)` keeps the Worker alive for background work.

## Deno

```ts
import app from './app.ts'

Deno.serve(app.fetch)
```

Or run `deno serve app.ts`.

## Bun

```ts
import app from './app.ts'

export default app
```

Run it with `bun app.ts`.

## Node.js

```ts
import { createServer } from 'node:http'
import { toNodeListener } from 'oleojs/node'
import app from './app.ts'

createServer(toNodeListener(app)).listen(3000)
```

`toNodeListener` works with `node:http`, `node:https`, and `node:http2`. You create, start, and stop the server yourself.

| Option | Default | Description |
| --- | --- | --- |
| `env` | none | The application environment. Required when the application needs one |
| `trustProxy` | `false` | Build the request URL from `X-Forwarded-Proto` and `X-Forwarded-Host`. Enable it only behind a proxy that sets these headers |
| `lazyRequest` | `true` | Pass a request object that creates the native `Request` only when needed. Set `false` to always pass a native `Request` |

The request object behaves like a `Request`, but two calls need a native one:

- `new Request(request, init)`. Build the new request from its parts instead: `new Request(request.url, { method: request.method, headers, signal: request.signal })`.
- `fetch(request)`, for example in a proxy. Use `fetch(request.clone())`.

Alternatively, set `lazyRequest: false`.

### FastResponse

`FastResponse` from `oleojs/node` takes the same arguments as `Response`. The adapter writes it directly, with a `Content-Length` header:

```ts
import { FastResponse } from 'oleojs/node'

get('/users/:id', (_request, ctx) => FastResponse.json({ id: ctx.params.id }))
```

Only the Node.js adapter recognizes it. Use `Response` in code that runs on other runtimes.

## The application environment

When handlers use `ctx.env` from [`router<Env>()`](/guide/middleware#the-application-environment), supply the environment on each runtime:

| Runtime | With an environment |
| --- | --- |
| Cloudflare Workers | `export default app`: Workers supplies your bindings |
| Deno | `Deno.serve((request) => app.fetch(request, env))` |
| Bun | `Bun.serve({ fetch: (request) => app.fetch(request, env) })` |
| Node.js | `toNodeListener(app, { env })` |

Deno and Bun pass their own server information as the second argument of `fetch`, so wrap the call as shown instead of passing `app.fetch` directly.

## Background work

`ctx.executionCtx.waitUntil(promise)` extends the request only on Cloudflare Workers. On Deno, Bun, and Node.js the promise keeps running, and a rejection is reported with `console.error`, but the runtime does not wait for it.
