# oleojs

A zero-runtime-dependency HTTP router and middleware library for TypeScript. Build applications from functions, compose request handling explicitly, and work with native Web `Request` and `Response` objects.

The portable core runs on Cloudflare Workers, Deno, and Bun. A separate adapter connects it to Node.js HTTP servers.

**Documentation: https://slime21023.github.io/oleojs/**

## Quick start

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

## Packages

| Entry point | Contents | Guide |
| --- | --- | --- |
| `oleojs` | Routing, groups, middleware composition, context keys, the Fetch entry point, and the extension API | [Guide](https://slime21023.github.io/oleojs/guide/introduction) |
| `oleojs/filters` | CORS, Bearer authentication, RFC 9457 problem details, request logging, body size limits, and message transformations | [Filters](https://slime21023.github.io/oleojs/filters/) |
| `oleojs/contract` | Validated inputs with Standard Schema and OpenAPI 3.1.1 generation | [Contracts](https://slime21023.github.io/oleojs/contracts/) |
| `oleojs/node` | Node.js HTTP/1.1 and HTTP/2 adapter | [Node.js](https://slime21023.github.io/oleojs/runtimes/node) |

## Runtimes

| Runtime | Application without env | Application with env |
| --- | --- | --- |
| Cloudflare Workers | `export default app` | `export default app` (Workers supplies `Env`) |
| Deno | `Deno.serve(app.fetch)` | `Deno.serve((request) => app.fetch(request, env))` |
| Bun | `export default app` | `Bun.serve({ fetch: (request) => app.fetch(request, env) })` |
| Node.js | `createServer(toNodeListener(app))` | `createServer(toNodeListener(app, { env }))` |

See the [runtime guide](https://slime21023.github.io/oleojs/runtimes/) for details.

## Development

```sh
bun install
bun run lint
bun run typecheck
bun run test
bun run docs:dev   # documentation site at http://localhost:5173/oleojs/
```

[CONTRIBUTING.md](CONTRIBUTING.md) covers the hard rules, toolchain, repository layout, testing, and standards conformance. [AGENTS.md](AGENTS.md) records the project's core goals and architectural principles.

## License

[MIT](LICENSE).
