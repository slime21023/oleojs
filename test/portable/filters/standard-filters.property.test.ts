import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { bearerAuth, bodyLimit, cors, requestLogger } from '../../../src/filters/index.ts'
import type { LogEntry } from '../../../src/filters/index.ts'
import { contextKey, toFetch } from '../../../src/index.ts'
import { paramValueArbitrary, PROPERTY_OPTIONS } from '../arbitraries.ts'

const token = fc.tuple(
  fc.array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~+/'), { minLength: 1, maxLength: 30 }),
  fc.integer({ min: 0, max: 4 }),
).map(([characters, padding]) => characters.join('') + '='.repeat(padding))

describe('CORS properties', () => {
  it('applies only the configured origin policy and preserves original responses', async () => {
    const origin = fc.stringMatching(/^[a-z]{1,10}$/).map((host) => `https://${host}.test`)
    await fc.assert(fc.asyncProperty(fc.uniqueArray(origin, { minLength: 1, maxLength: 5 }), fc.boolean(), async (origins, allowed) => {
      const requestOrigin = allowed ? origins[0]! : 'https://blocked.invalid'
      const original = new Response('body', { headers: { Vary: 'Accept-Encoding', 'X-Original': 'yes' } })
      const before = [...original.headers]
      const response = await toFetch(cors({ origin: origins })(() => original)).fetch(new Request('https://api.test/', { headers: { Origin: requestOrigin } }))
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(allowed ? requestOrigin : null)
      if (!allowed) expect(response).toBe(original)
      expect([...original.headers]).toEqual(before)
      expect(await response.text()).toBe('body')
    }), PROPERTY_OPTIONS)
  })

  it('preserves existing Vary fields and adds Origin only when it is needed', async () => {
    const names = fc.array(fc.constantFrom('Accept-Encoding', 'ORIGIN', 'origin', 'User-Agent', '*'), { maxLength: 5 })
    await fc.assert(fc.asyncProperty(names, async (names) => {
      const value = names.join(', ')
      const original = new Response(null, { headers: { Vary: value } })
      const response = await toFetch(cors({ origin: '*' })(() => original)).fetch(new Request('https://api.test/', { headers: { Origin: 'https://app.test' } }))
      const tokens = (response.headers.get('Vary') ?? '').split(',').map((name) => name.trim().toLowerCase()).filter(Boolean)
      for (const name of names) expect(tokens).toContain(name.toLowerCase())
      if (names.includes('*')) expect(response.headers.get('Vary')).toBe(value)
      else expect(tokens.filter((name) => name === 'origin')).toHaveLength(Math.max(1, names.filter((name) => name.toLowerCase() === 'origin').length))
      expect(original.headers.get('Vary')).toBe(value)
    }), PROPERTY_OPTIONS)
  })
})

describe('Bearer authentication properties', () => {
  it('passes valid tokens unchanged and keeps every non-undefined principal', async () => {
    await fc.assert(fc.asyncProperty(token, fc.jsonValue(), fc.constantFrom('Bearer', 'BEARER', 'bearer'), fc.integer({ min: 1, max: 4 }), async (token, principal, scheme, spaces) => {
      const key = contextKey<unknown>('principal')
      let calls = 0
      const handler = bearerAuth({ key, verify: (received) => { calls++; expect(received).toBe(token); return principal } })(
        (_req, ctx) => { expect(key.get(ctx)).toBe(principal); return new Response() },
      )
      const response = await toFetch(handler).fetch(new Request('https://api.test/', { headers: { Authorization: `${scheme}${' '.repeat(spaces)}${token}` } }))
      expect(response.status).toBe(200)
      expect(calls).toBe(1)
    }), PROPERTY_OPTIONS)
  })

  it('rejects embedded token separators before verification without echoing credentials', async () => {
    await fc.assert(fc.asyncProperty(token, fc.constantFrom(' ', '\t', ',', ':', '?'), async (token, separator) => {
      let calls = 0
      const handler = bearerAuth({ verify: () => { calls++; return true } })(() => new Response())
      const response = await toFetch(handler).fetch(new Request('https://api.test/', { headers: { Authorization: `Bearer ${token}${separator}${token}` } }))
      expect(response.status).toBe(400)
      expect(response.body).toBeNull()
      expect(response.headers.get('WWW-Authenticate')).toBe('Bearer error="invalid_request"')
      expect(calls).toBe(0)
    }), PROPERTY_OPTIONS)
  })
})

describe('request logging properties', () => {
  it('records the actual method, encoded path, and status while excluding query strings', async () => {
    await fc.assert(fc.asyncProperty(paramValueArbitrary, fc.string(), fc.integer({ min: 200, max: 599 }), fc.constantFrom('GET', 'POST', 'HEAD'), async (segment, secret, status, method) => {
      const path = `/files/${encodeURIComponent(segment)}`
      const req = new Request(`https://api.test${path}?${new URLSearchParams({ secret })}`, { method })
      const logs: LogEntry[] = []
      const response = new Response(null, { status })
      const handler = requestLogger({
        log: (entry) => { logs.push(entry) },
        fields: () => ({ method: 'wrong', path: 'wrong', status: -1, error: true, durationMs: -1 }),
      })(() => response)
      expect(await toFetch(handler).fetch(req)).toBe(response)
      expect(logs).toHaveLength(1)
      expect(logs[0]).toEqual({ method, path: new URL(req.url).pathname, status, durationMs: expect.any(Number) })
      expect(logs[0]!.durationMs).toBeGreaterThanOrEqual(0)
      expect(logs[0]!.durationMs * 10).toBeCloseTo(Math.round(logs[0]!.durationMs * 10), 6)
    }), PROPERTY_OPTIONS)
  })

  it('preserves arbitrary rejections and omits a status even when extra fields supply one', async () => {
    await fc.assert(fc.asyncProperty(fc.jsonValue(), async (error) => {
      const logs: LogEntry[] = []
      const handler = requestLogger({ log: (entry) => { logs.push(entry) }, fields: () => ({ status: 200, error: false }) })(() => { throw error })
      await expect(toFetch(handler).fetch(new Request('https://api.test/'))).rejects.toBe(error)
      expect(logs).toHaveLength(1)
      expect(logs[0]).toMatchObject({ method: 'GET', path: '/', error: true })
      expect(logs[0]).not.toHaveProperty('status')
    }), PROPERTY_OPTIONS)
  })
})

describe('body limit properties', () => {
  it('forwards exactly the received bytes if and only if they fit the limit', async () => {
    const chunks = fc.array(fc.uint8Array({ maxLength: 16 }), { maxLength: 8 })
    await fc.assert(fc.asyncProperty(chunks, fc.integer({ min: 0, max: 96 }), async (parts, maxBytes) => {
      const expected = new Uint8Array(parts.flatMap((part) => [...part]))
      let pulled = 0
      const stream = new ReadableStream({
        pull(controller) {
          if (pulled === parts.length) controller.close()
          else controller.enqueue(parts[pulled++])
        },
      }, { highWaterMark: 0 })
      // Streaming request bodies need runtime-specific duplex support; shadow the byte body instead.
      const req = new Request('https://api.test/', { method: 'POST', body: 'placeholder' })
      Object.defineProperty(req, 'body', { value: stream })
      let received: Uint8Array | undefined
      const app = toFetch(bodyLimit({ maxBytes })(async (forwarded) => {
        received = new Uint8Array(await forwarded.arrayBuffer())
        return new Response(null, { status: 204 })
      }))
      const response = await app.fetch(req)
      if (expected.byteLength <= maxBytes) {
        expect(response.status).toBe(204)
        expect(received).toEqual(expected)
      } else {
        expect(response.status).toBe(413)
        expect(received).toBeUndefined()
      }
    }), PROPERTY_OPTIONS)
  })
})
