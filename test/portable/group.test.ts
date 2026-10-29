import { describe, expect, it } from 'vitest'
import { compose } from '../../src/compose.ts'
import { del, get, group, post, route, router } from '../../src/router.ts'
import { EMPTY_PARAMS } from '../../src/context-defaults.ts'
import type { Context, HttpFilter, HttpHandler } from '../../src/types.ts'

const ctx: Context = { params: EMPTY_PARAMS, env: undefined, executionCtx: { waitUntil() {} } }
const ok = () => new Response()

function call(handler: HttpHandler, path: string, method = 'GET') {
  return Promise.resolve(handler(new Request(`http://example.test${path}`, { method }), ctx))
}

const echo: HttpHandler = (req, ctx) => Response.json(ctx.params)

describe('flattening', () => {
  it('joins the prefix onto each route', async () => {
    const app = router(group('/api', get('/users', echo)))
    expect((await call(app, '/api/users')).status).toBe(200)
    expect((await call(app, '/users')).status).toBe(404)
  })

  it('merges params from nested prefixes and the route', async () => {
    const app = router(group('/orgs/:orgId', group('/users/:userId', get('/posts/:postId', echo))))
    expect(await (await call(app, '/orgs/1/users/2/posts/3')).json()).toEqual({ orgId: '1', userId: '2', postId: '3' })
  })

  it("addresses the prefix itself with '' and its trailing slash with '/'", async () => {
    const app = router(group('/users/:id', get('', () => new Response('exact')), get('/', () => new Response('slash'))))
    expect(await (await call(app, '/users/1')).text()).toBe('exact')
    expect(await (await call(app, '/users/1/')).text()).toBe('slash')
  })

  it('shares one trie with ungrouped routes for priority and Allow lists', async () => {
    const app = router(get('/a/x', ok), group('/a', post('/x', ok), get('/:id', echo)))
    expect((await call(app, '/a/x', 'PUT')).headers.get('Allow')).toBe('GET, HEAD, POST')
    expect(await (await call(app, '/a/y')).json()).toEqual({ id: 'y' })
  })

  it('falls back from HEAD to a grouped GET route', async () => {
    const app = router(group('/a', get('/b', () => new Response('body'))))
    const res = await call(app, '/a/b', 'HEAD')
    expect([res.status, res.body]).toEqual([200, null])
  })
})

describe('definition errors', () => {
  it('never throws from group() itself', () => {
    expect(() => group('api//', get('/*/x', ok))).not.toThrow()
  })

  it.each([
    ['a prefix not starting with /', group('api', get('/x', ok)), 'Invalid route pattern "api/x"'],
    ['a prefix ending with /', group('/api/', get('/x', ok)), '"/api//x": empty segment'],
    ['a prefix containing *', group('/files/*', get('/x', ok)), '"*" must be the last segment'],
    ["'' at top level", get('', ok), 'Invalid route pattern "": must start with "/"'],
    ['a param repeated across prefix and route', group('/u/:id', get('/:id', ok)), 'duplicate parameter ":id"'],
  ])('rejects %s when router() is called', (_, item, message) => {
    expect(() => router(item)).toThrow(TypeError)
    expect(() => router(item)).toThrow(message)
  })

  it('detects duplicates between grouped and ungrouped routes', () => {
    expect(() => router(get('/api/users', ok), group('/api', get('/users', ok)))).toThrow('duplicate route for GET')
  })

  it('names the full pattern in method errors', () => {
    expect(() => router(group('/api', del('/x', ok), route('get', '/y', ok)))).toThrow(
      'Invalid route method "get" for "/api/y"',
    )
  })

  it('rejects values that are neither routes nor groups, such as misplaced options', () => {
    const misplaced = group('/api', get('/x', ok), { filters: [] } as never)
    expect(() => router(misplaced)).toThrow('router() expects routes and groups (in group "/api")')
    expect(() => router({} as never)).toThrow('router() expects routes and groups, got [object Object]')
  })
})

describe('group filters', () => {
  it('leaves nested filters in reverse order after the handler returns', async () => {
    const log: string[] = []
    const around = (name: string): HttpFilter => (next) => async (req, ctx) => {
      log.push(`${name} in`)
      const res = await next(req, ctx)
      log.push(`${name} out`)
      return res
    }
    const app = router(group('/a', { filters: [around('outer')] },
      group('/b', { filters: [around('inner')] },
        get('/c', () => {
          log.push('handler')
          return new Response('ok')
        }),
      ),
    ))
    expect(await (await call(app, '/a/b/c')).text()).toBe('ok')
    expect(log).toEqual(['outer in', 'inner in', 'handler', 'inner out', 'outer out'])
  })

  function tracing(name: string, log: string[]): HttpFilter {
    return (next) => async (req, ctx) => {
      log.push(name)
      return next(req, ctx)
    }
  }

  it('run outermost first: around the router, outer group, inner group, route, handler', async () => {
    const log: string[] = []
    const app = compose(tracing('global', log))(
      router(
        group('/a', { filters: [tracing('outer', log), tracing('outer2', log)] },
          group('/b', { filters: [tracing('inner', log)] },
            get('/c', tracing('route', log)(() => (log.push('handler'), new Response()))),
          ),
        ),
      ),
    )
    await call(app, '/a/b/c')
    expect(log).toEqual(['global', 'outer', 'outer2', 'inner', 'route', 'handler'])
  })

  it('see route params', async () => {
    let seen: unknown
    const peek: HttpFilter = (next) => (req, ctx) => ((seen = ctx.params), next(req, ctx))
    await call(router(group('/users/:id', { filters: [peek] }, get('/posts/:postId', ok))), '/users/1/posts/2')
    expect(seen).toEqual({ id: '1', postId: '2' })
  })

  it('apply only to the routes in their group', async () => {
    const deny: HttpFilter = () => () => new Response(null, { status: 403 })
    const app = router(get('/public', ok), group('/admin', { filters: [deny] }, get('/users', ok)))
    expect((await call(app, '/public')).status).toBe(200)
    expect((await call(app, '/admin/users')).status).toBe(403)
  })

  it('are applied once per route when router() is called, not per request', async () => {
    let applications = 0
    const counting: HttpFilter = (next) => (applications++, next)
    const app = router(group('/a', { filters: [counting] }, get('/x', ok), get('/y', ok), group('/b', get('/z', ok))))
    expect(applications).toBe(3)
    await call(app, '/a/x')
    await call(app, '/a/x')
    expect(applications).toBe(3)
  })

  it('do not run for unmatched paths under the prefix', async () => {
    let ran = false
    const auth: HttpFilter = () => () => ((ran = true), new Response(null, { status: 401 }))
    const app = router(group('/admin', { filters: [auth] }, get('/users', ok)))
    expect((await call(app, '/admin/nope')).status).toBe(404)
    expect(ran).toBe(false)
  })
})

describe('group values', () => {
  it('are frozen, with frozen filters and items', () => {
    const value = group('/a', { filters: [] }, get('/x', ok))
    expect([Object.isFrozen(value), Object.isFrozen(value.filters), Object.isFrozen(value.items)]).toEqual([true, true, true])
    expect([value.prefix, value.items.length]).toEqual(['/a', 1])
  })

  it('treat a leading route as an item, not as options', () => {
    expect(group('/a', get('/x', ok), get('/y', ok)).items).toHaveLength(2)
  })
})
