# Getting started

## Installation

```sh
npm install oleojs
```

oleojs has no runtime dependencies. It runs on Cloudflare Workers, Deno, Bun, and Node.js 22 or later. Type inference is verified with TypeScript 7; older TypeScript versions are untested.

::: warning Not yet published
The package is not on npm yet (version `0.0.0`). Until the first release, build it from the repository with `bun run build` and depend on the local checkout.
:::

## First application

Create an application in `app.ts`:

```ts
import { get, group, router, toFetch } from 'oleojs'

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

## Next steps

- [Routing](/guide/routing) and [route groups](/guide/groups) explain patterns, parameters, and prefixes.
- [Middleware](/guide/middleware) shows how filters and context keys pass data through a request.
- [Runtimes](/runtimes/) lists the entry point for each platform.
