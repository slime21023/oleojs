import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { HttpFilter } from '../../src/index.ts'
import { get, post, router, toFetch, withFilters } from '../../src/index.ts'
import { toNodeListener } from '../../src/node/index.ts'
import { FILLER_ROUTE_COUNT, MIDDLEWARE_COUNT, announce } from '../scenarios.ts'

const passThrough: HttpFilter = (next) => (request, ctx) => next(request, ctx)

const routes = router(
  get('/', () => new Response('Hello, World!')),
  get('/users/:userId/posts/:postId', (_request, ctx) => Response.json({
    userId: ctx.params.userId,
    postId: ctx.params.postId,
  })),
  post('/echo', async (request) => Response.json(await request.json())),
  get('/middleware', withFilters(() => new Response('ok'), ...Array.from({ length: MIDDLEWARE_COUNT }, () => passThrough))),
  ...Array.from({ length: FILLER_ROUTE_COUNT }, (_, index) =>
    get(`/api/resource${index}/:id`, (_request, ctx) => Response.json({ id: ctx.params.id }))),
)

const server = createServer(toNodeListener(toFetch(routes)))
server.listen(0, '127.0.0.1', () => announce((server.address() as AddressInfo).port))
