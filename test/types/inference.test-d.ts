// Type inference contract for the public API (docs/project-reference.md, Building an application).
// Never weaken or delete a case to make it pass.
import { describe, expectTypeOf, it } from 'vitest'
import { compose } from '../../src/compose.ts'
import { contextKey } from '../../src/context-key.ts'
import { toFetch } from '../../src/fetch.ts'
import { type Route, type RouteGroup, get, group, router, routesFor } from '../../src/index.ts'
import type { ExecutionContext, FetchHandler, HttpFilter, HttpHandler, JoinParams, Params, ParamsOf } from '../../src/types.ts'

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

describe('route groups', () => {
  const logger: HttpFilter = (next) => (req, ctx) => next(req, ctx)
  const needsDb: HttpFilter<Env> = (next) => (req, ctx) => next(req, ctx)

  it('passes prefix params to inline routes', () => {
    router(
      group('/users/:userId', get('/posts/:postId', (req, ctx) => {
        expectTypeOf(ctx.params).toEqualTypeOf<{ readonly userId: string; readonly postId: string }>()
        return ok()
      })),
    )
  })

  it('accumulates params through nested groups', () => {
    router(
      group('/orgs/:orgId', group('/users/:userId', get('', (req, ctx) => {
        expectTypeOf(ctx.params).toEqualTypeOf<{ readonly orgId: string; readonly userId: string }>()
        return ok()
      }))),
    )
  })

  it('keeps inference with an options object', () => {
    router(
      group('/admin/:tenant', { filters: [logger] }, get('/users/:id', (req, ctx) => {
        expectTypeOf(ctx.params).toEqualTypeOf<{ readonly tenant: string; readonly id: string }>()
        return ok()
      })),
    )
  })

  it('passes env from router<E>() through groups and their filters', () => {
    router<Env>(
      group('/a', { filters: [needsDb] }, get('/b', (req, ctx) => {
        expectTypeOf(ctx.env).toEqualTypeOf<Env>()
        return ok()
      })),
    )
  })

  it('accepts separately declared handlers typed with their full params', () => {
    const show: HttpHandler<unknown, ParamsOf<'/users/:id'>> = ok
    const post: HttpHandler<unknown, JoinParams<ParamsOf<'/users/:userId'>, ParamsOf<'/posts/:postId'>>> = ok
    router(get('/users/:id', show), group('/users/:userId', get('/posts/:postId', post)))
  })

  it('rejects a group filter that needs a different env', () => {
    // @ts-expect-error -- needsDb requires Env
    router<OtherEnv>(group('/a', { filters: [needsDb] }, get('/b', ok)))
  })

  it('rejects params declared by neither the prefix nor the pattern', () => {
    group('/users/:userId', get('/x', (req, ctx) => {
      // @ts-expect-error -- not declared
      void ctx.params.nope
      return ok()
    }))
  })

  it('types groups from another module through a RouteGroup annotation', () => {
    const userRoutes = (): RouteGroup<Env> =>
      group('/users/:userId', get('/posts/:postId', (req, ctx) => {
        expectTypeOf(ctx.params).toEqualTypeOf<{ readonly userId: string; readonly postId: string }>()
        expectTypeOf(ctx.env).toEqualTypeOf<Env>()
        return ok()
      }))
    const teamRoutes: RouteGroup = group('/teams/:teamId', group('/members/:memberId', get('', (req, ctx) => {
      expectTypeOf(ctx.params).toEqualTypeOf<{ readonly teamId: string; readonly memberId: string }>()
      return ok()
    })))
    router<Env>(userRoutes(), teamRoutes)
    // @ts-expect-error -- an Env group cannot go into a router of another env
    router<OtherEnv>(userRoutes())
  })

  it('fails to compile, never goes untyped, when the annotation is missing', () => {
    const unannotated = () =>
      group('/users/:userId', get('/x', (req, ctx) => {
        // @ts-expect-error -- without a RouteGroup annotation the prefix param is missing
        void ctx.params.userId
        return ok()
      }))
    router(unannotated())
  })

  it('rejects an item needing a parameter its group does not supply, with or without options', () => {
    const needsUser: Route<unknown, { userId: string }> = get('/settings', ok)
    group('/users/:userId', needsUser)
    group('/users/:userId', { filters: [logger] }, needsUser)
    // @ts-expect-error -- the prefix supplies teamId, not userId
    group('/teams/:teamId', needsUser)
    // @ts-expect-error -- the same check applies after options
    group('/teams/:teamId', { filters: [logger] }, needsUser)
    // @ts-expect-error -- options are accepted only before the items
    group('/users/:userId', needsUser, { filters: [logger] })
  })

  it('checks a leading group as an item, not as options with filters', () => {
    const userGroup: RouteGroup<unknown, { userId: string }> = group('/posts', get('', ok))
    group('/users/:userId', userGroup)
    // @ts-expect-error -- a group has filters, but it must still satisfy the item check
    group('/teams/:teamId', userGroup)
    // @ts-expect-error -- also when nested below the prefix that is missing userId
    group('/teams/:teamId', group('/x', userGroup))
  })
})

describe('handlers', () => {
  it('accepts clients as handlers', () => {
    const client = (req: Request) => fetch(req)
    expectTypeOf(client).toExtend<HttpHandler>()
  })
})

describe('fetch entry', () => {
  const request = new Request('https://test/')

  it('requires env when the handler needs one', () => {
    const app = toFetch(router<Env>(get('/', ok)))
    // @ts-expect-error -- Env is required
    void app.fetch(request)
    // @ts-expect-error -- the environment must have the handler's type
    void app.fetch(request, { KV: '' })
    void app.fetch(request, { DB: { query: (sql) => sql } })
    void app.fetch(request, { DB: { query: (sql) => sql } }, { waitUntil() {} })
  })

  it('keeps env optional when undefined is a valid environment', () => {
    void toFetch(router(get('/', ok))).fetch(request)
    void toFetch<Env | undefined>(ok).fetch(request)
    expectTypeOf<Parameters<FetchHandler['fetch']>>().toEqualTypeOf<[Request, env?: unknown, executionCtx?: ExecutionContext]>()
  })

  it('types object-literal handlers contextually', () => {
    const app: FetchHandler<Env> = {
      fetch: async (req, env, executionCtx) => {
        expectTypeOf(env).toEqualTypeOf<Env>()
        expectTypeOf(executionCtx).toEqualTypeOf<ExecutionContext | undefined>()
        return ok()
      },
    }
    expectTypeOf(app).toExtend<FetchHandler<Env>>()
  })
})

describe('environment-bound helpers', () => {
  it('types separately declared routes with the bound environment', () => {
    const { get: getWithEnv, post: postWithEnv } = routesFor<Env>()
    const list = getWithEnv('/items/:id', (req, ctx) => {
      expectTypeOf(ctx.env).toEqualTypeOf<Env>()
      expectTypeOf(ctx.params).toEqualTypeOf<{ readonly id: string }>()
      return ok()
    })
    expectTypeOf(list).toEqualTypeOf<Route<Env>>()
    const create = postWithEnv('/items', ok)
    router<Env>(list, create)
    // @ts-expect-error -- an Env route cannot go into a router of another env
    router<OtherEnv>(list)
  })

  it('still infers enclosing parameters inline', () => {
    const needsDb: HttpFilter<Env> = (next) => (req, ctx) => next(req, ctx)
    const helpers = routesFor<Env>()
    router<Env>(helpers.group('/users/:userId', { filters: [needsDb] }, helpers.get('/posts/:postId', (req, ctx) => {
      expectTypeOf(ctx.params).toEqualTypeOf<{ readonly userId: string; readonly postId: string }>()
      expectTypeOf(ctx.env).toEqualTypeOf<Env>()
      return ok()
    })))
  })

  it('types the inline routes of a group declared on its own, unlike an unannotated core group', () => {
    const { get: getWithEnv, group: groupWithEnv } = routesFor<Env>()
    const users = groupWithEnv('/users/:userId',
      getWithEnv('/profile', (req, ctx) => {
        expectTypeOf(ctx.params).toEqualTypeOf<{ readonly userId: string }>()
        expectTypeOf(ctx.env).toEqualTypeOf<Env>()
        return ok()
      }),
      // Nested inline inside a parameterized group, the core group infers the enclosing parameters.
      group('/posts', get('/:postId', (req, ctx) => {
        expectTypeOf(ctx.params).toEqualTypeOf<{ readonly userId: string; readonly postId: string }>()
        return ok()
      })),
    )
    expectTypeOf(users).toEqualTypeOf<RouteGroup<Env>>()
    router<Env>(users)
  })

  it('binds the parameters of the groups a separate route will be placed in', () => {
    const { get: userGet, group: userGroup } = routesFor<Env, ParamsOf<'/users/:userId'>>()
    const settings = userGet('/settings', (req, ctx) => {
      expectTypeOf(ctx.params).toEqualTypeOf<{ readonly userId: string }>()
      return ok()
    })
    const posts = userGroup('/posts/:postId', get('', (req, ctx) => {
      expectTypeOf(ctx.params).toEqualTypeOf<{ readonly userId: string; readonly postId: string }>()
      return ok()
    }))
    router<Env>(group('/users/:userId', settings, posts))
    // @ts-expect-error -- the prefix supplies teamId, not userId
    router<Env>(group('/teams/:teamId', settings))
    // @ts-expect-error -- a route requiring userId cannot be placed at the top level
    router<Env>(posts)
  })

  it('rejects params declared by neither the bound base nor the pattern', () => {
    routesFor<Env>().get('/x', (req, ctx) => {
      // @ts-expect-error -- not declared
      void ctx.params.nope
      return ok()
    })
  })

  it('shares the existing helpers at runtime', () => {
    expectTypeOf(routesFor<Env>().get).toBeFunction()
  })
})
