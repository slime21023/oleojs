import { describe, expect, it, vi } from 'vitest'
import { get, group, inspectRoutes, post, route, router, routesFor, toFetch, withRouteCheck } from '../../../src/index.ts'
import type { HttpFilter, RouteEntry } from '../../../src/index.ts'

const ok = () => new Response('ok')
const passThrough = (): HttpFilter => (next) => next

describe('inspectRoutes', () => {
  it('lists full patterns, canonical segments and outer-first filters in definition order', () => {
    const outer = passThrough()
    const inner = passThrough()
    const health = get('/health', ok)
    const show = get('/:id/café', ok)
    const create = post('', ok)
    const entries = inspectRoutes(health, group('/users', { filters: [outer] }, create, group('/x', { filters: [inner] }, show)))
    expect(entries.map(({ method, pattern, segments }) => [method, pattern, segments])).toEqual([
      ['GET', '/health', ['health']],
      ['POST', '/users', ['users']],
      ['GET', '/users/x/:id/café', ['users', 'x', ':id', 'caf%C3%A9']],
    ])
    expect(entries.map((entry) => entry.route)).toEqual([health, create, show])
    expect(entries.map((entry) => entry.filters)).toEqual([[], [outer], [outer, inner]])
  })

  it('never invokes handlers or filters', () => {
    const handler = vi.fn(ok)
    let wrapped = 0
    const filter: HttpFilter = (next) => ((wrapped++), next)
    inspectRoutes(group('/a', { filters: [filter] }, get('/b', handler)))
    expect(handler).not.toHaveBeenCalled()
    expect(wrapped).toBe(0)
  })

  it('returns frozen entries', () => {
    const entries = inspectRoutes(get('/a/:id', ok))
    expect(Object.isFrozen(entries)).toBe(true)
    expect(Object.isFrozen(entries[0])).toBe(true)
    expect(Object.isFrozen(entries[0]!.segments)).toBe(true)
    expect(Object.isFrozen(entries[0]!.filters)).toBe(true)
  })

  it.each([
    ['an invalid pattern', [get('users', ok)]],
    ['an invalid method', [route('get', '/a', ok)]],
    ['a duplicate route', [get('/a', ok), get('/a', ok)]],
    ['conflicting parameter names', [get('/u/:id', ok), post('/u/:userId', ok)]],
    ['an invalid item', [{} as never]],
  ])('throws the router() error for %s', (_case, items) => {
    let expected: unknown
    try {
      router(...items)
    } catch (error) {
      expected = error
    }
    expect(expected).toBeInstanceOf(TypeError)
    expect(() => inspectRoutes(...items)).toThrow((expected as Error).message)
  })
})

describe('withRouteCheck', () => {
  it('returns a new route and leaves the original unchecked', () => {
    const original = get('/a', ok)
    const checked = withRouteCheck(original, () => {
      throw new TypeError('rejected')
    })
    expect(checked).not.toBe(original)
    expect(Object.isFrozen(checked)).toBe(true)
    expect([checked.method, checked.pattern, checked.handler]).toEqual([original.method, original.pattern, original.handler])
    expect(() => router(original)).not.toThrow()
    expect(() => router(checked)).toThrow('rejected')
    expect(() => inspectRoutes(checked)).toThrow('rejected')
  })

  it('runs checks in order with the full grouped entry', () => {
    const seen: string[] = []
    const record = (label: string) => (entry: RouteEntry) => {
      seen.push(`${label} ${entry.method} ${entry.pattern} ${entry.segments.join('|')}`)
    }
    const checked = withRouteCheck(withRouteCheck(get('/:id', ok), record('first')), record('second'))
    router(group('/users', checked))
    expect(seen).toEqual(['first GET /users/:id users|:id', 'second GET /users/:id users|:id'])
  })

  it('serves a checked route like the original', async () => {
    const { get: getWithEnv } = routesFor<{ greeting: string }>()
    const checked = withRouteCheck(getWithEnv('/:name', (_req, ctx) => new Response(`${ctx.env.greeting} ${ctx.params.name}`)), () => {})
    const app = toFetch(router(group('/hello', checked)))
    expect(await (await app.fetch(new Request('https://test/hello/ada'), { greeting: 'hi' })).text()).toBe('hi ada')
  })

  it('rejects values that are not routes and checks that are not functions', () => {
    expect(() => withRouteCheck(group('/a') as never, () => {})).toThrow('withRouteCheck() expects a route')
    expect(() => withRouteCheck(get('/a', ok), 'check' as never)).toThrow('withRouteCheck() expects check to be a function')
  })
})
