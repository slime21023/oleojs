import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { HttpFilter } from '../../src/index.ts'
import { get, post, router, toFetch, withFilters } from '../../src/index.ts'
import { FastResponse, toNodeListener } from '../../src/node/index.ts'
import { FILLER_ROUTE_COUNT, MIDDLEWARE_COUNT, announce } from '../scenarios.ts'

// `--fast-response` answers with oleojs/node's FastResponse instead of the native Response.
const R = process.argv.includes('--fast-response') ? FastResponse : Response

const passThrough: HttpFilter = (next) => (request, ctx) => next(request, ctx)

const routes = router(
  get('/', () => new R('Hello, World!')),
  get('/users/:userId/posts/:postId', (_request, ctx) => R.json({
    userId: ctx.params.userId,
    postId: ctx.params.postId,
  })),
  post('/echo', async (request) => R.json(await request.json())),
  get('/middleware', withFilters(() => new R('ok'), ...Array.from({ length: MIDDLEWARE_COUNT }, () => passThrough))),
  ...Array.from({ length: FILLER_ROUTE_COUNT }, (_, index) =>
    get(`/api/resource${index}/:id`, (_request, ctx) => R.json({ id: ctx.params.id }))),
)

// `--native-request` benchmarks the adapter with `lazyRequest: false`.
const lazyRequest = !process.argv.includes('--native-request')
const server = createServer(toNodeListener(toFetch(routes), { lazyRequest }))
server.listen(0, '127.0.0.1', () => announce((server.address() as AddressInfo).port))
