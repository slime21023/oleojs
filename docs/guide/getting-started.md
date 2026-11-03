# Getting started

## Install

```sh
npm install oleojs
```

oleojs runs on Cloudflare Workers, Deno, Bun, and Node.js 22 or later, and is tested with TypeScript 7.

::: warning Not yet published
The package is not on npm yet. Until the first release, build it from the repository with `bun run build` and depend on the local checkout.
:::

## Your first application

<<< @/examples/getting-started.ts#app

`get('/users/:id', handler)` matches `GET /users/42`, and `ctx.params.id` is `'42'`. The parameter name is typed from the pattern.

`toFetch` turns the router into an object with a `fetch(request)` method, which is what every runtime calls.

## Run it

| Runtime | Command or code |
| --- | --- |
| Bun | `bun app.ts` |
| Deno | `deno serve app.ts` |
| Cloudflare Workers | `export default app` is already the Worker |
| Node.js | `createServer(toNodeListener(app)).listen(3000)` |

See [Runtimes](/runtimes/) for details.

## Test it

`app.fetch` is a plain function, so tests need no server:

<<< @/examples/getting-started.ts#test

## Next steps

- [Routing](/guide/routing): patterns, methods, and groups.
- [Middleware](/guide/middleware): filters, shared values, and the application environment.
- [Filters](/filters/): ready-made CORS, authentication, error, logging, and body-limit filters.
