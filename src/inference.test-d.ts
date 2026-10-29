// Type inference contract for the public API (AGENTS.md, Building an application).
// Never weaken or delete a case to make it pass.
import { describe, expectTypeOf, it } from 'vitest'
import { compose } from './compose.ts'
import { contextKey } from './context-key.ts'
import { toFetch } from './fetch.ts'
import { get, router } from './router.ts'
import type { FetchHandler, HttpFilter, HttpHandler, Params } from './types.ts'

interface Env {
  DB: { query(sql: string): string }
}
interface OtherEnv {
  KV: string
}
const ok = () => new Response()

describe('route parameters', () => {
  it('infers params from the pattern', () => {
    get('/users/:id/files/*', (req, ctx) => {
      expectTypeOf(ctx.params).toEqualTypeOf<{ readonly id: string; readonly '*': string }>()
      // @ts-expect-error -- not declared by the pattern
      void ctx.params.nope
      return ok()
    })
  })

  it('infers empty params for a static pattern', () => {
    get('/static', (req, ctx) => {
      expectTypeOf(ctx.params).toEqualTypeOf<{}>()
      return ok()
    })
  })

  it('falls back to Params for a non-literal pattern', () => {
    const pattern: string = '/dynamic'
    get(pattern, (req, ctx) => {
      expectTypeOf(ctx.params).toEqualTypeOf<Params>()
      return ok()
    })
  })
})

describe('env', () => {
  it('flows from router<E>() into route handlers', () => {
    router<Env>(
      get('/q', (req, ctx) => {
        expectTypeOf(ctx.env).toEqualTypeOf<Env>()
        return ok()
      }),
    )
  })

  it('is inferred when env-agnostic and env-specific handlers are mixed', () => {
    const createUser: HttpHandler = ok
    const query: HttpHandler<Env> = ok
    expectTypeOf(router(get('/users', createUser), get('/db', query))).toEqualTypeOf<HttpHandler<Env>>()
  })

  it('rejects a handler that needs a different env', () => {
    const kv: HttpHandler<OtherEnv> = ok
    // @ts-expect-error -- OtherEnv is not Env
    router<Env>(get('/kv', kv))
  })
})

describe('filters', () => {
  const logger: HttpFilter = (next) => (req, ctx) => next(req, ctx)
  const needsDb: HttpFilter<Env> = (next) => (req, ctx) => {
    ctx.env.DB.query('select 1')
    return next(req, ctx)
  }

  it('keeps params and env when wrapping a single route', () => {
    router<Env>(
      get('/users/:id', logger((req, ctx) => {
        expectTypeOf(ctx.params).toEqualTypeOf<{ readonly id: string }>()
        expectTypeOf(ctx.env).toEqualTypeOf<Env>()
        return ok()
      })),
    )
  })

  it('lets env-agnostic filters wrap env-specific handlers', () => {
    const routes: HttpHandler<Env> = ok
    expectTypeOf(compose(logger)(routes)).toEqualTypeOf<HttpHandler<Env>>()
    expectTypeOf(compose(logger, needsDb)(routes)).toEqualTypeOf<HttpHandler<Env>>()
    expectTypeOf(toFetch(compose(logger)(routes))).toEqualTypeOf<FetchHandler<Env>>()
  })

  it('rejects an env-requiring filter on a handler with a different env', () => {
    const routes: HttpHandler<OtherEnv> = ok
    // @ts-expect-error -- needsDb requires Env
    needsDb(routes)
    // @ts-expect-error -- also through compose, mixed with an env-agnostic filter
    compose(logger, needsDb)(routes)
  })

  it('does not treat an env-requiring filter as a filter of another env', () => {
    // @ts-expect-error -- an HttpFilter<Env> is not an HttpFilter<OtherEnv>
    const leaked: HttpFilter<OtherEnv> = needsDb
    const widened: HttpFilter<Env> = logger
    void [leaked, widened]
  })

  it('passes context-key values downstream', () => {
    const userKey = contextKey<{ name: string }>('user')
    const bearerAuth: HttpFilter = (next) => (req, ctx) => next(req, userKey.with(ctx, { name: 'x' }))
    get('/me', bearerAuth((req, ctx) => {
      expectTypeOf(userKey.get(ctx)).toEqualTypeOf<{ name: string }>()
      return ok()
    }))
  })
})

describe('handlers', () => {
  it('accepts clients as handlers', () => {
    const client = (req: Request) => fetch(req)
    expectTypeOf(client).toExtend<HttpHandler>()
  })
})
