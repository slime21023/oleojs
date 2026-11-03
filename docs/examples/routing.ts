import { del, get, group, post, route, router } from 'oleojs'

// #region routes
const routes = router(
  get('/posts', () => Response.json([])),
  post('/posts', async (request) => Response.json(await request.json(), { status: 201 })),
  get('/posts/:id', (_request, ctx) => Response.json({ id: ctx.params.id })),
  del('/posts/:id', () => new Response(null, { status: 204 })),
  get('/files/*', (_request, ctx) => new Response(ctx.params['*'])),
  route('PROPFIND', '/dav', () => new Response(null, { status: 207 })),
)
// #endregion routes

// #region groups
const api = router(
  group('/api',
    get('/health', () => new Response('ok')),         // GET /api/health
    group('/users/:userId',
      get('', (_request, ctx) => Response.json(ctx.params)),                // GET /api/users/:userId
      get('/posts/:postId', (_request, ctx) => Response.json(ctx.params)), // { userId, postId }
    ),
  ),
)
// #endregion groups

export { api, routes }
