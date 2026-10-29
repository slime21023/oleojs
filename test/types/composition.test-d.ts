import { describe, expectTypeOf, it } from 'vitest'
import { compose } from '../../src/compose.ts'
import { get, group, router, toFetch, withFilters } from '../../src/index.ts'
import type { FetchHandler, HttpFilter, HttpHandler, ParamsOf } from '../../src/types.ts'

interface DbEnv { db: string }
interface CacheEnv { cache: string }
type Env = DbEnv & CacheEnv
const needsDb: HttpFilter<DbEnv> = (next) => (req, ctx) => next(req, ctx)
const needsCache: HttpFilter<CacheEnv> = (next) => (req, ctx) => next(req, ctx)
const neutral: HttpFilter = (next) => next
const handler: HttpHandler<Env, ParamsOf<'/items/:id'>> = () => new Response()

describe('composed filter environments', () => {
  it('intersects independent requirements in either order', () => {
    expectTypeOf(compose(needsDb, needsCache)).toEqualTypeOf<HttpFilter<Env>>()
    expectTypeOf(compose(needsCache, needsDb)).toEqualTypeOf<HttpFilter<Env>>()
    expectTypeOf(compose(needsDb, needsCache)(handler)).toEqualTypeOf<typeof handler>()
  })

  it('keeps requirements when mixed with environment-agnostic filters', () => {
    expectTypeOf(compose(neutral, needsDb, neutral, needsCache, neutral)).toEqualTypeOf<HttpFilter<Env>>()
    expectTypeOf(compose(neutral, neutral)).toEqualTypeOf<HttpFilter>()
  })

  it('combines nested stacks without losing either requirement', () => {
    const stack = compose(compose(neutral, needsDb), compose(needsCache, neutral))
    expectTypeOf(stack).toEqualTypeOf<HttpFilter<Env>>()
    expectTypeOf(stack(handler)).toEqualTypeOf<typeof handler>()
  })

  it('supports readonly tuples and heterogeneous arrays without weakening their requirements', () => {
    const tuple = [needsDb, neutral, needsCache] as const
    const array = [needsDb, needsCache]
    expectTypeOf(compose(...tuple)).toEqualTypeOf<HttpFilter<Env>>()
    expectTypeOf(compose(...array)).toEqualTypeOf<HttpFilter<Env>>()
    const missingCache: HttpHandler<DbEnv> = () => new Response()
    const app = toFetch(compose(...array)(missingCache))
    expectTypeOf(app).toEqualTypeOf<FetchHandler<Env>>()
    // @ts-expect-error -- any array entry can require the cache.
    app.fetch(new Request('https://test/'), { db: 'db' })
  })

  it('retains identity and explicitly supplied environment types', () => {
    expectTypeOf(compose()).toEqualTypeOf<HttpFilter>()
    expectTypeOf(compose<Env>(needsDb, needsCache)).toEqualTypeOf<HttpFilter<Env>>()
    expectTypeOf(compose<Env>()).toEqualTypeOf<HttpFilter<Env>>()
    // @ts-expect-error -- an explicit environment must satisfy every filter.
    compose<DbEnv>(needsDb, needsCache)
  })

  it('preserves contextual route and group parameters', () => {
    router<Env>(
      get('/items/:id', compose(needsDb, needsCache)((_req, ctx) => {
        expectTypeOf(ctx.env).toEqualTypeOf<Env>()
        expectTypeOf(ctx.params).toEqualTypeOf<{ readonly id: string }>()
        return new Response()
      })),
      group('/teams/:team', { filters: [compose(needsDb, needsCache)] }, get('/items/:id', (_req, ctx) => {
        expectTypeOf(ctx.env).toEqualTypeOf<Env>()
        expectTypeOf(ctx.params).toEqualTypeOf<{ readonly team: string; readonly id: string }>()
        return new Response()
      })),
    )
  })

  it('allows handlers using a subset while requiring the complete environment from callers', () => {
    const stack = compose(needsDb, needsCache)
    const dbOnly: HttpHandler<DbEnv> = () => new Response()
    const cacheOnly: HttpHandler<CacheEnv> = () => new Response()
    expectTypeOf(stack(dbOnly)).toEqualTypeOf<HttpHandler<Env>>()
    expectTypeOf(stack(cacheOnly)).toEqualTypeOf<HttpHandler<Env>>()
    const app = toFetch(stack(dbOnly))
    // @ts-expect-error -- callers must still supply a cache.
    app.fetch(new Request('https://test/'), { db: 'db' })
    // @ts-expect-error -- callers must still supply a database.
    app.fetch(new Request('https://test/'), { cache: 'cache' })
    // @ts-expect-error -- the stack cannot be widened to an environment-agnostic filter.
    const unsafe: HttpFilter = stack
    void unsafe
  })

  it('does not widen incompatible requirements on the same field', () => {
    const numericDb: HttpFilter<{ db: number }> = (next) => next
    const stack = compose(needsDb, numericDb)
    const stringDb: HttpHandler<DbEnv> = () => new Response()
    const app = toFetch(stack(stringDb))
    // @ts-expect-error -- a string database cannot also satisfy a numeric database.
    app.fetch(new Request('https://test/'), { db: 'db' })
  })
})

describe('withFilters', () => {
  it('preserves a typed handler and intersects filter requirements', () => {
    expectTypeOf(withFilters(handler, needsDb, needsCache)).toEqualTypeOf<typeof handler>()
    const dbHandler: HttpHandler<DbEnv> = () => new Response()
    expectTypeOf(withFilters(dbHandler, needsCache)).toEqualTypeOf<HttpHandler<Env>>()
    expectTypeOf(withFilters(() => new Response(), needsDb, needsCache)).toEqualTypeOf<HttpHandler<Env>>()
  })

  it('types inline handler environments from the filters', () => {
    withFilters((_req, ctx) => {
      expectTypeOf(ctx.env).toEqualTypeOf<Env>()
      return new Response(ctx.env.db + ctx.env.cache)
    }, needsDb, needsCache)
  })

  it('preserves identity and handles empty or neutral filter lists', () => {
    expectTypeOf(withFilters(handler)).toEqualTypeOf<typeof handler>()
    expectTypeOf(withFilters(handler, neutral)).toEqualTypeOf<typeof handler>()
    expectTypeOf(withFilters(() => new Response())).toEqualTypeOf<HttpHandler>()
  })

  it('keeps contextual route and group parameters', () => {
    router<Env>(group('/teams/:team', get('/items/:id', withFilters((_req, ctx) => {
      expectTypeOf(ctx.env).toEqualTypeOf<Env>()
      expectTypeOf(ctx.params).toEqualTypeOf<{ readonly team: string; readonly id: string }>()
      return new Response(ctx.params.id)
    }, needsDb, needsCache))))
  })

  it('requires the complete environment at the Fetch boundary', () => {
    const app = toFetch(withFilters(() => new Response(), needsDb, needsCache))
    app.fetch(new Request('https://test/'), { db: 'db', cache: 'cache' })
    // @ts-expect-error -- the cache is required by a filter.
    app.fetch(new Request('https://test/'), { db: 'db' })
    // @ts-expect-error -- the database is required by a filter.
    app.fetch(new Request('https://test/'), { cache: 'cache' })
  })
})
