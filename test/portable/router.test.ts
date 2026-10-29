import { describe, expect, it } from 'vitest'
import { del, get, head, options, patch, post, put, route, router } from '../../src/router.ts'
import { EMPTY_PARAMS } from '../../src/trie.ts'
import type { Context, HttpHandler } from '../../src/types.ts'

const ctx: Context = { params: EMPTY_PARAMS, env: undefined, executionCtx: { waitUntil() {} } }

function call(handler: HttpHandler, path: string, init?: RequestInit, context: Context = ctx) {
  return Promise.resolve(handler(new Request(`http://example.test${path}`, init), context))
}

const echo: HttpHandler = (req, ctx) => Response.json({ method: req.method, params: ctx.params })

describe('route helpers', () => {
  it('produce frozen route values with their method', () => {
    const handler = () => new Response()
    const routes = [get, post, put, patch, del, head, options].map((helper) => helper('/a', handler))
    expect(routes.map((r) => r.method)).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
    expect(routes.every((r) => Object.isFrozen(r) && r.pattern === '/a' && r.handler === handler)).toBe(true)
    expect(route('PROPFIND', '/dav/*', handler).method).toBe('PROPFIND')
  })
})

describe('router', () => {
  it.each(['__proto__', 'constructor', 'toString'])('captures prototype property name %s as an own parameter', async (name) => {
    const app = router(get(`/users/:${name}`, (_req, ctx) => {
      expect(Object.hasOwn(ctx.params, name)).toBe(true)
      return Response.json(ctx.params)
    }))
    for (const [path, value] of [['alice', 'alice'], ['a%2Fb', 'a/b']]) {
      const res = await call(app, `/users/${path}`)
      expect(await res.json()).toEqual(Object.fromEntries([[name, value]]))
    }
  })

  it('dispatches to the matched handler with params in a derived context', async () => {
    const app = router(get('/users/:id', echo), post('/users', echo))
    expect(await (await call(app, '/users/42')).json()).toEqual({ method: 'GET', params: { id: '42' } })
    expect(await (await call(app, '/users', { method: 'POST' })).json()).toEqual({ method: 'POST', params: {} })
  })

  it('never mutates the context and keeps context-key entries', async () => {
    const key = Symbol('user')
    const outer = Object.freeze({ ...ctx, [key]: 'alice' })
    let seen: Context | undefined
    const app = router(get('/users/:id', (req, ctx) => ((seen = ctx), new Response())))
    await call(app, '/users/42', undefined, outer)
    expect(seen).not.toBe(outer)
    expect(seen?.params).toEqual({ id: '42' })
    expect((seen as unknown as Record<symbol, unknown>)[key]).toBe('alice')
    expect(outer.params).toBe(EMPTY_PARAMS)
  })

  it('passes the same context through for routes without params', async () => {
    let seen: Context | undefined
    const app = router(get('/a', (req, ctx) => ((seen = ctx), new Response())))
    await call(app, '/a')
    expect(seen).toBe(ctx)
  })

  it('nests routers as plain handlers', async () => {
    const api = router(get('/api/users/:id', echo))
    const app = router(get('/api/*', api))
    expect(await (await call(app, '/api/users/7')).json()).toEqual({ method: 'GET', params: { id: '7' } })
  })
})

describe('default responses', () => {
  const app = router(get('/users/:id', echo), del('/users/:id', echo), post('/users/me', echo))

  it('returns an empty 404 when no path matches', async () => {
    const res = await call(app, '/nope')
    expect(res.status).toBe(404)
    expect(res.body).toBeNull()
  })

  it('returns an empty 405 with the Allow union when the method does not match', async () => {
    const res = await call(app, '/users/me', { method: 'PUT' })
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('DELETE, GET, HEAD, POST')
    expect(res.body).toBeNull()
  })

  it('returns an empty 400 for malformed percent-encoding', async () => {
    const res = await call(app, '/users/%E0%A4%A')
    expect(res.status).toBe(400)
    expect(res.body).toBeNull()
  })

  it('creates a fresh response every time', async () => {
    expect(await call(app, '/nope')).not.toBe(await call(app, '/nope'))
  })
})

describe('HEAD', () => {
  it.each(['throw', 'reject'])('propagates a cancellation failure (%s)', async (mode) => {
    const error = new Error('cancel failed')
    const app = router(get('/a', () => new Response(new ReadableStream({
      cancel() {
        if (mode === 'throw') throw error
        return Promise.reject(error)
      },
    }))))
    await expect(call(app, '/a', { method: 'HEAD' })).rejects.toBe(error)
  })

  it('falls back to GET and drops the body, keeping status and headers', async () => {
    const app = router(get('/a', () => new Response('body', { status: 201, headers: { 'X-A': '1' } })))
    const res = await call(app, '/a', { method: 'HEAD' })
    expect(res.status).toBe(201)
    expect(res.headers.get('X-A')).toBe('1')
    expect(res.body).toBeNull()
  })

  it('drops the body of async handlers too', async () => {
    const app = router(get('/a', async () => new Response('body')))
    expect((await call(app, '/a', { method: 'HEAD' })).body).toBeNull()
  })

  it('prefers an explicit HEAD route and returns a body-less response as-is', async () => {
    const response = new Response(null, { headers: { 'X-Head': '1' } })
    const app = router(get('/a', () => new Response('get')), head('/a', () => response))
    expect(await call(app, '/a', { method: 'HEAD' })).toBe(response)
  })
})

describe('route definition errors', () => {
  const handler = () => new Response()

  it('throws when router() is called, not when the route is created', () => {
    const invalid = get('/a//b', handler)
    expect(() => router(invalid)).toThrow(TypeError)
  })

  it.each([
    ['g e t', 'is not a valid HTTP method'],
    ['', 'is not a valid HTTP method'],
    ['get', 'Fetch normalizes it to "GET"'],
    ['Post', 'Fetch normalizes it to "POST"'],
    ['CONNECT', 'is forbidden by Fetch'],
    ['trace', 'is forbidden by Fetch'],
  ])('rejects method %j', (method, message) => {
    expect(() => router(route(method, '/a', handler))).toThrow(message)
  })

  it('accepts methods that Fetch does not normalize, in any casing', () => {
    expect(() => router(route('patch', '/a', handler), route('PROPFIND', '/a', handler))).not.toThrow()
  })
})
