import type { HttpFilter } from '../../src/index.ts'
import { get, post, router, withFilters } from '../../src/index.ts'
import { FILLER_ROUTE_COUNT, MIDDLEWARE_COUNT } from '../scenarios.ts'

/** The Response class handlers use: the native one, or oleojs/node's FastResponse. */
export interface ResponseClass {
  new (body?: BodyInit | null, init?: ResponseInit): Response
  json(data: unknown, init?: ResponseInit): Response
}

const passThrough: HttpFilter = (next) => (request, ctx) => next(request, ctx)

/** The benchmark routes, shared by the oleojs apps for every entry point. */
export function createRoutes(R: ResponseClass) {
  return router(
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
}
