import { describe, expect, it, vi } from 'vitest'
import { bearerAuth } from '../../../src/filters/index.ts'
import type { BearerAuthOptions } from '../../../src/filters/index.ts'
import { contextKey, get, group, router, toFetch } from '../../../src/index.ts'
import type { Context, HttpHandler } from '../../../src/types.ts'

const request = (authorization?: string, path = '/') => new Request(`https://example.test${path}`, {
  headers: authorization === undefined ? {} : { Authorization: authorization },
})

describe('bearerAuth options', () => {
  it.each([
    undefined, null, [], {}, { verify: true }, { verify: () => true, key: null },
    { verify: () => true, key: {} }, { verify: () => true, realm: 1 },
    ...['a"b', 'a\\b', 'a\nb', 'a\tb', 'a\0b', 'a\x7fb', '領域'].map((realm) => ({ verify: () => true, realm })),
  ])('rejects invalid options during construction: %s', (options) => {
    expect(() => bearerAuth(options as BearerAuthOptions)).toThrow(TypeError)
  })
})

describe('Bearer challenges', () => {
  it.each([undefined, '', 'Basic abc', 'Bearerish abc', 'Digest abc'])('challenges missing or different schemes: %s', async (authorization) => {
    const verify = vi.fn(() => true)
    const next = vi.fn(() => new Response())
    const response = await toFetch(bearerAuth({ verify })(next)).fetch(request(authorization))
    expect(response.status).toBe(401)
    expect(response.headers.get('WWW-Authenticate')).toBe('Bearer')
    expect(response.body).toBeNull()
    expect(verify).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it.each(['Bearer', 'Bearer   ', 'Bearer =', 'Bearer abc def', 'Bearer abc=def', 'Bearer abc,def', 'Bearer abc:secret', 'Bearer\tabc', 'Bearer abc\tdef'])('rejects malformed Bearer credentials without verification: %s', async (authorization) => {
    const verify = vi.fn(() => true)
    const next = vi.fn(() => new Response())
    const response = await toFetch(bearerAuth({ verify })(next)).fetch(request(authorization))
    expect(response.status).toBe(400)
    expect(response.headers.get('WWW-Authenticate')).toBe('Bearer error="invalid_request"')
    expect(response.body).toBeNull()
    expect(verify).not.toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })

  it.each([undefined, '', 'members'])('formats realm and invalid-token challenges: %s', async (realm) => {
    const next = vi.fn(() => new Response())
    const app = toFetch(bearerAuth({ verify: () => undefined, realm })(next))
    const prefix = realm === undefined ? 'Bearer' : `Bearer realm="${realm}"`
    const missing = await app.fetch(request())
    expect(missing.headers.get('WWW-Authenticate')).toBe(prefix)
    const invalid = await app.fetch(request('Bearer valid.syntax=='))
    expect(invalid.status).toBe(401)
    expect(invalid.body).toBeNull()
    expect(invalid.headers.get('WWW-Authenticate')).toBe(`${prefix}${realm === undefined ? ' ' : ', '}error="invalid_token"`)
    expect(next).not.toHaveBeenCalled()
  })
})

describe('token verification', () => {
  it.each(['Bearer', 'bearer', 'BEARER', 'bEaReR'])('accepts scheme casing and multiple spaces: %s', async (scheme) => {
    const verify = vi.fn(() => true)
    const req = request(`${scheme}   aZ09-._~+/===`)
    const original = new Response('ok')
    const response = await toFetch(bearerAuth({ verify })(() => original)).fetch(req)
    expect(response).toBe(original)
    expect(verify).toHaveBeenCalledExactlyOnceWith('aZ09-._~+/===', req, expect.anything())
  })

  it('passes the original request and context to async verification and derives the principal context', async () => {
    interface Env { DB: string }
    const userKey = contextKey<{ id: string }>('user')
    const markerKey = contextKey<string>('marker')
    const principal = { id: 'alice' }
    let original: Context<Env> | undefined
    let derived: Context<Env> | undefined
    const req = request('Bearer token')
    const verify = vi.fn(async (token: string, received: Request, ctx: Context<Env>) => {
      expect(token).toBe('token')
      expect(received).toBe(req)
      expect(ctx.env.DB).toBe('database')
      original = ctx
      return principal
    })
    const protectedHandler: HttpHandler<Env> = bearerAuth({ verify, key: userKey })((_request, ctx) => {
      derived = ctx
      expect(userKey.get(ctx)).toBe(principal)
      expect(markerKey.get(ctx)).toBe('kept')
      return new Response('ok')
    })
    const app = toFetch<Env>((req, ctx) => protectedHandler(req, markerKey.with(ctx, 'kept')))
    await app.fetch(req, { DB: 'database' })
    expect(derived).not.toBe(original)
    expect(original && userKey.find(original)).toBeUndefined()
    expect(derived?.env).toBe(original?.env)
  })

  it.each([null, false, 0, '', { id: 'alice' }])('accepts any principal except undefined: %j', async (principal) => {
    const key = contextKey<unknown>('principal')
    const next = vi.fn((_req: Request, ctx: Context) => {
      expect(key.get(ctx)).toEqual(principal)
      return new Response()
    })
    const response = await toFetch(bearerAuth({ verify: () => principal, key })(next)).fetch(request('Bearer token'))
    expect(response.status).toBe(200)
    expect(next).toHaveBeenCalledOnce()
  })

  it('passes the same context downstream when no key is configured', async () => {
    let verified: Context | undefined
    const response = await toFetch(bearerAuth({ verify: (_token, _req, ctx) => { verified = ctx; return true } })(
      (_req, ctx) => { expect(ctx).toBe(verified); return new Response() },
    )).fetch(request('Bearer token'))
    expect(response.status).toBe(200)
  })

  it.each(['throw', 'reject'])('propagates verification failure through %s', async (mode) => {
    const error = new Error('verification unavailable')
    const next = vi.fn(() => new Response())
    const app = toFetch(bearerAuth({ verify: () => {
      if (mode === 'reject') return Promise.reject(error)
      throw error
    } })(next))
    await expect(app.fetch(request('Bearer token'))).rejects.toBe(error)
    expect(next).not.toHaveBeenCalled()
  })

  it('protects matched group routes and preserves prefix parameters', async () => {
    const key = contextKey<string>('user')
    const verify = vi.fn(() => 'alice')
    const app = toFetch(router(group('/users/:id', { filters: [bearerAuth({ verify, key })] },
      get('', (_req, ctx) => Response.json({ id: ctx.params.id, user: key.get(ctx) })),
    )))
    expect((await app.fetch(request(undefined, '/users/42'))).status).toBe(401)
    expect((await app.fetch(request(undefined, '/users/42/missing'))).status).toBe(404)
    expect(verify).not.toHaveBeenCalled()
    const response = await app.fetch(request('Bearer token', '/users/42'))
    expect(await response.json()).toEqual({ id: '42', user: 'alice' })
  })
})
