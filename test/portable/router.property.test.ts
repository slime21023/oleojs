import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { get, group, route, router, toFetch } from '../../src/index.ts'
import { PROPERTY_OPTIONS, paramNameArbitrary, paramValueArbitrary, staticSegmentArbitrary } from './arbitraries.ts'

describe('routing properties', () => {
  it('preserves own parameter names and decodes values exactly once', async () => {
    await fc.assert(fc.asyncProperty(paramNameArbitrary, paramValueArbitrary, async (name, value) => {
      const app = toFetch(router(get(`/users/:${name}`, (_req, ctx) => {
        expect(Object.hasOwn(ctx.params, name)).toBe(true)
        return Response.json(ctx.params)
      })))
      const res = await app.fetch(new Request(`https://test/users/${encodeURIComponent(value)}`))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual(Object.fromEntries([[name, value]]))
    }), { ...PROPERTY_OPTIONS, examples: [['__proto__', 'alice'], ['id', '%2F']] })
  })

  it('keeps priority and method-aware backtracking independent of registration order', async () => {
    const order = fc.shuffledSubarray([0, 1, 2], { minLength: 3, maxLength: 3 })
    await fc.assert(fc.asyncProperty(order, paramValueArbitrary, fc.boolean(), async (indices, value, staticGet) => {
      const routes = [
        route(staticGet ? 'GET' : 'POST', '/items/fixed', () => new Response('static')),
        get('/items/:id', () => new Response('param')),
        get('/items/*', () => new Response('wildcard')),
      ]
      const app = toFetch(router(...indices.map((index) => routes[index]!)))
      const cases = [
        ['/items/fixed', staticGet ? 'static' : 'param'],
        [`/items/${encodeURIComponent(`v${value}`)}`, 'param'],
        [`/items/${encodeURIComponent(value)}/tail`, 'wildcard'],
        ['/items/', 'wildcard'],
      ]
      for (const [path, expected] of cases) {
        expect(await (await app.fetch(new Request(`https://test${path}`))).text()).toBe(expected)
      }
    }), PROPERTY_OPTIONS)
  })

  it('unions, sorts and deduplicates Allow across all matching routes', async () => {
    const methods = fc.array(fc.constantFrom('GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'), {
      minLength: 1,
      maxLength: 12,
    })
    await fc.assert(fc.asyncProperty(methods, async (registered) => {
      const uniqueMethods = [...new Set(registered)]
      const app = toFetch(router(...uniqueMethods.flatMap((method) => [
        route(method, '/items/fixed', () => new Response()),
        route(method, '/items/:id', () => new Response()),
        route(method, '/items/*', () => new Response()),
      ])))
      const expected = new Set(uniqueMethods)
      if (expected.has('GET')) expected.add('HEAD')
      const res = await app.fetch(new Request('https://test/items/fixed', { method: 'PROPFIND' }))
      expect(res.status).toBe(405)
      expect(res.headers.get('Allow')).toBe([...expected].sort().join(', '))
      expect(res.body).toBeNull()
    }), PROPERTY_OPTIONS)
  })

  it('makes nested groups equivalent to concatenated route patterns', async () => {
    await fc.assert(fc.asyncProperty(
      staticSegmentArbitrary, paramValueArbitrary, paramValueArbitrary, fc.boolean(),
      async (prefix, org, id, trailingSlash) => {
        const suffix = trailingSlash ? '/' : ''
        const grouped = toFetch(router(group(`/${prefix}/:org`, group('/users/:id',
          get(suffix, (_req, ctx) => Response.json(ctx.params)),
        ))))
        const flat = toFetch(router(get(`/${prefix}/:org/users/:id${suffix}`, (_req, ctx) => Response.json(ctx.params))))
        const url = `https://test/${encodeURIComponent(prefix)}/${encodeURIComponent(org)}/users/${encodeURIComponent(id)}${suffix}`
        const a = await grouped.fetch(new Request(url))
        const b = await flat.fetch(new Request(url))
        expect([a.status, b.status]).toEqual([200, 200])
        expect(await a.json()).toEqual({ org, id })
        expect(await b.json()).toEqual({ org, id })
      },
    ), PROPERTY_OPTIONS)
  })

  it('returns 400 only when malformed encoding belongs to the selected route', async () => {
    await fc.assert(fc.asyncProperty(
      paramValueArbitrary, fc.constantFrom('%', '%ZZ', '%C0%AF', '%ED%A0%80', '%E0%A4%A'),
      async (prefix, malformed) => {
        const app = toFetch(router(get('/items/:id/end', () => new Response())))
        const base = `https://test/items/${encodeURIComponent(prefix)}${malformed}`
        expect((await app.fetch(new Request(`${base}/end`))).status).toBe(400)
        expect((await app.fetch(new Request(`${base}/other`))).status).toBe(404)
        const wrongMethod = await app.fetch(new Request(`${base}/end`, { method: 'POST' }))
        expect(wrongMethod.status).toBe(405)
        expect(wrongMethod.headers.get('Allow')).toBe('GET, HEAD')
      },
    ), PROPERTY_OPTIONS)
  })
})
