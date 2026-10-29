import { describe, expectTypeOf, it } from 'vitest'
import { compose, contextKey, get, group, router, toFetch, withFilters } from '../../src/index.ts'
import type { Context, HttpFilter, HttpHandler, ParamsOf } from '../../src/index.ts'
import { mapRequest, mapResponse, responseHeaders } from '../../src/filters/index.ts'
import type { RequestTransform, ResponseTransform } from '../../src/filters/index.ts'

interface DbEnv { db: string }
interface CacheEnv { cache: string }
type Env = DbEnv & CacheEnv
const handler: HttpHandler<Env, ParamsOf<'/items/:id'>> = () => new Response()

describe('transformation filters', () => {
  it('preserves handler environments and parameters', () => {
    expectTypeOf(mapRequest((req) => req)).toEqualTypeOf<HttpFilter>()
    expectTypeOf(mapResponse((res) => res)).toEqualTypeOf<HttpFilter>()
    expectTypeOf(responseHeaders({ 'X-App': 'oleo' })).toEqualTypeOf<HttpFilter>()
    expectTypeOf(mapRequest((req) => req)(handler)).toEqualTypeOf<typeof handler>()
    expectTypeOf(mapResponse((res) => res)(handler)).toEqualTypeOf<typeof handler>()
    expectTypeOf(responseHeaders({ 'X-App': 'oleo' })(handler)).toEqualTypeOf<typeof handler>()
  })

  it('infers environment requirements from annotated callbacks', () => {
    const requestFilter = mapRequest((req, ctx: Context<DbEnv>) => new Request(req, { headers: { 'X-Db': ctx.env.db } }))
    const responseFilter = mapResponse(async (res, _req, ctx: Context<CacheEnv>) => {
      expectTypeOf(ctx.env.cache).toEqualTypeOf<string>()
      return res
    })
    expectTypeOf(requestFilter).toEqualTypeOf<HttpFilter<DbEnv>>()
    expectTypeOf(responseFilter).toEqualTypeOf<HttpFilter<CacheEnv>>()
    expectTypeOf(compose(requestFilter, responseFilter)).toEqualTypeOf<HttpFilter<Env>>()
    const app = toFetch(router<Env>(get('/items/:id', withFilters(handler, requestFilter, responseFilter))))
    // @ts-expect-error -- the combined filters require the cache as well.
    app.fetch(new Request('https://test/'), { db: 'db' })
  })

  it('types callbacks from a typed handler supplied to withFilters', () => {
    withFilters(handler,
      mapRequest((req, ctx) => {
        expectTypeOf(ctx.env).toEqualTypeOf<Env>()
        return req
      }),
      mapResponse((res, req, ctx) => {
        expectTypeOf(req).toEqualTypeOf<Request>()
        expectTypeOf(ctx.env).toEqualTypeOf<Env>()
        return res
      }),
    )
  })

  it('preserves contextual group and route inference', () => {
    router<Env>(group('/teams/:team', { filters: [
      mapRequest((req, ctx) => {
        expectTypeOf(ctx.env).toEqualTypeOf<Env>()
        return req
      }),
      mapResponse((res, _req, ctx) => {
        expectTypeOf(ctx.env).toEqualTypeOf<Env>()
        return res
      }),
      responseHeaders({ 'X-App': 'oleo' }),
    ] }, get('/items/:id', withFilters((_req, ctx) => {
      expectTypeOf(ctx.params).toEqualTypeOf<{ readonly team: string; readonly id: string }>()
      expectTypeOf(ctx.env).toEqualTypeOf<Env>()
      return new Response()
    }, mapResponse((res) => res)))))
  })

  it('accepts typed transforms, asynchronous results, and native header inputs', () => {
    const request: RequestTransform<Env> = async (req, ctx) => {
      expectTypeOf(ctx.env).toEqualTypeOf<Env>()
      return req
    }
    const response: ResponseTransform<Env> = (res, _req, ctx) => {
      expectTypeOf(ctx.env).toEqualTypeOf<Env>()
      return res
    }
    mapRequest(request)
    mapResponse(response)
    responseHeaders(new Headers())
    responseHeaders([['X-App', 'oleo']])
    responseHeaders({ 'X-App': 'oleo' } as const)
  })

  it('supports typed context keys in transforms', () => {
    const user = contextKey<{ id: string }>('user')
    mapResponse((res, _req, ctx) => {
      expectTypeOf(user.get(ctx)).toEqualTypeOf<{ id: string }>()
      return res
    })
  })

  it('rejects wrong return types and malformed header shapes', () => {
    // @ts-expect-error -- a request transform must return a Request.
    mapRequest(() => new Response())
    // @ts-expect-error -- asynchronous transforms also return a Request.
    mapRequest(async () => undefined)
    // @ts-expect-error -- a response transform must return a Response.
    mapResponse(() => new Request('https://test/'))
    // @ts-expect-error -- response observers without a return value are not transforms.
    mapResponse(() => {})
    // @ts-expect-error -- a transform callback is required.
    mapRequest()
    // @ts-expect-error -- headers use native string values.
    responseHeaders({ 'X-Count': 1 })
  })
})
