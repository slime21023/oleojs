import { describe, expect, it, vi } from 'vitest'
import { cors } from '../../../src/filters/index.ts'
import type { CorsOptions } from '../../../src/filters/index.ts'
import { toFetch } from '../../../src/index.ts'

function request(origin?: string, headers: HeadersInit = {}, method = 'GET') {
  const values = new Headers(headers)
  if (origin !== undefined) values.set('Origin', origin)
  return new Request('https://api.test/resource', { method, headers: values })
}

describe('cors options', () => {
  it.each([
    undefined, null, [], {}, { origin: null }, { origin: 1 }, { origin: ['*'] },
    { origin: 'https://app.test/' }, { origin: 'https://app.test/path' }, { origin: 'not an origin' },
    { origin: 'https://APP.test' }, { origin: ['https://app.test', 1] }, { origin: 'null' },
    { origin: '*', credentials: true }, { origin: '*', credentials: 'yes' },
    { origin: '*', maxAge: -1 }, { origin: '*', maxAge: 0.5 }, { origin: '*', maxAge: Infinity },
    { origin: '*', maxAge: NaN }, { origin: '*', maxAge: '60' },
    { origin: '*', methods: null }, { origin: '*', methods: 'GET' }, { origin: '*', methods: ['GET POST'] },
    { origin: '*', allowHeaders: ['X-User\r\nInjected: yes'] }, { origin: '*', exposeHeaders: [1] },
  ])('rejects invalid options at construction: %j', (options) => {
    expect(() => cors(options as CorsOptions)).toThrow(TypeError)
  })

  it('captures configured lists when the factory is called', async () => {
    const origins = ['https://app.test']
    const methods = ['GET']
    const headers = ['X-One']
    const handler = toFetch(cors({ origin: origins, methods, allowHeaders: headers })(() => new Response()))
    origins[0] = 'https://other.test'
    methods.push('POST')
    headers.push('X-Two')
    const response = await handler.fetch(request('https://app.test', { 'Access-Control-Request-Method': 'GET' }, 'OPTIONS'))
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET')
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('X-One')
  })
})

describe('ordinary CORS requests', () => {
  it.each([undefined, 'https://other.test'])('passes an absent or disallowed origin through unchanged: %s', async (origin) => {
    const original = new Response('original')
    const next = vi.fn(() => original)
    const response = await toFetch(cors({ origin: 'https://app.test' })(next)).fetch(request(origin))
    expect(response).toBe(original)
    expect(next).toHaveBeenCalledOnce()
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false)
    expect(response.headers.has('Vary')).toBe(false)
  })

  it('sets a wildcard and preserves the original status, headers, and streaming body', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
    const original = new Response(stream, { status: 202, statusText: 'Accepted here', headers: { 'X-Original': 'yes' } })
    const before = [...original.headers]
    const response = await toFetch(cors({ origin: '*' })(() => original)).fetch(request('https://app.test'))
    expect(response.status).toBe(202)
    expect(response.statusText).toBe('Accepted here')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull()
    expect(response.headers.get('X-Original')).toBe('yes')
    expect(response.bodyUsed).toBe(false)
    expect([...original.headers]).toEqual(before)
    if (controller === undefined) throw new Error('Stream start did not run')
    controller.enqueue(new TextEncoder().encode('bo'))
    controller.enqueue(new TextEncoder().encode('dy'))
    controller.close()
    expect(await response.text()).toBe('body')
  })

  it.each(['https://app.test', ['https://app.test', 'https://second.test']])('echoes allowed origins: %j', async (origin) => {
    const response = await toFetch(cors({ origin, credentials: true, exposeHeaders: ['X-Count', 'X-Page'] })(() => new Response()))
      .fetch(request('https://app.test'))
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.test')
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe('X-Count, X-Page')
    expect(response.headers.get('Vary')).toBe('Origin')
  })

  it('calls a synchronous predicate with the origin and original request', async () => {
    const req = request('null')
    const origin = vi.fn((value: string) => value === 'null')
    const response = await toFetch(cors({ origin })(() => new Response())).fetch(req)
    expect(origin).toHaveBeenCalledExactlyOnceWith('null', req)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('null')
  })

  it('does not evaluate the origin predicate when the header is absent', async () => {
    const origin = vi.fn(() => true)
    await toFetch(cors({ origin })(() => new Response())).fetch(request())
    expect(origin).not.toHaveBeenCalled()
  })

  it.each([false, 'yes', 1, undefined])('requires an explicit true from an origin predicate: %s', async (result) => {
    const original = new Response()
    const origin = (() => result) as (origin: string, req: Request) => boolean
    expect(await toFetch(cors({ origin })(() => original)).fetch(request('https://app.test'))).toBe(original)
  })

  it.each(['predicate', 'handler'])('propagates %s errors', async (source) => {
    const failure = new Error('failure')
    const origin = () => { if (source === 'predicate') throw failure; return true }
    const next = () => { throw failure }
    await expect(toFetch(cors({ origin })(next)).fetch(request('https://app.test'))).rejects.toBe(failure)
  })

  it.each([
    ['Accept-Encoding', 'Accept-Encoding, Origin'],
    ['origin, Accept-Encoding', 'origin, Accept-Encoding'],
    ['*', '*'],
  ])('merges Vary without duplicate names or changing a wildcard: %s', async (existing, expected) => {
    const original = new Response(null, { headers: { Vary: existing } })
    const response = await toFetch(cors({ origin: '*' })(() => original)).fetch(request('https://app.test'))
    expect(response.headers.get('Vary')).toBe(expected)
    expect(original.headers.get('Vary')).toBe(existing)
  })

  it('can enrich a response with immutable headers', async () => {
    const original = Response.redirect('https://other.test/', 302)
    const response = await toFetch(cors({ origin: '*' })(() => original)).fetch(request('https://app.test'))
    expect(response.headers.get('Location')).toBe('https://other.test/')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(original.headers.has('Access-Control-Allow-Origin')).toBe(false)
  })

  it('preserves network-error responses', async () => {
    const original = Response.error()
    expect(await toFetch(cors({ origin: '*' })(() => original)).fetch(request('https://app.test'))).toBe(original)
  })

  it('applies disabled credentials and exposure to inherited CORS headers', async () => {
    const original = new Response(null, { headers: { 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Expose-Headers': '*' } })
    const response = await toFetch(cors({ origin: '*' })(() => original)).fetch(request('https://app.test'))
    expect(response.headers.has('Access-Control-Allow-Credentials')).toBe(false)
    expect(response.headers.has('Access-Control-Expose-Headers')).toBe(false)
    expect(original.headers.get('Access-Control-Allow-Credentials')).toBe('true')
  })
})

describe('CORS preflight', () => {
  it('answers without calling the handler and reflects requested headers', async () => {
    const next = vi.fn(() => new Response('unexpected'))
    const response = await toFetch(cors({ origin: 'https://app.test', credentials: true, maxAge: 0 })(next))
      .fetch(request('https://app.test', { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'X-User, Authorization' }, 'OPTIONS'))
    expect(next).not.toHaveBeenCalled()
    expect(response.status).toBe(204)
    expect(response.body).toBeNull()
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.test')
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, HEAD, PUT, PATCH, POST, DELETE')
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('X-User, Authorization')
    expect(response.headers.get('Access-Control-Max-Age')).toBe('0')
    expect(response.headers.get('Vary')).toBe('Origin, Access-Control-Request-Headers')
  })

  it('uses configured methods and headers without reflecting or exposing response headers', async () => {
    const response = await toFetch(cors({ origin: '*', methods: ['POST'], allowHeaders: ['Authorization'], exposeHeaders: ['X-Count'], maxAge: 60 })(() => new Response()))
      .fetch(request('https://app.test', { 'Access-Control-Request-Method': 'DELETE', 'Access-Control-Request-Headers': 'X-Other' }, 'OPTIONS'))
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST')
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Authorization')
    expect(response.headers.get('Access-Control-Max-Age')).toBe('60')
    expect(response.headers.has('Access-Control-Expose-Headers')).toBe(false)
    expect(response.headers.get('Vary')).toBe('Origin')
  })

  it.each([undefined, []])('omits an empty allowed-header list and an unset maxAge: %j', async (allowHeaders) => {
    const response = await toFetch(cors({ origin: '*', allowHeaders })(() => new Response()))
      .fetch(request('https://app.test', { 'Access-Control-Request-Method': 'GET' }, 'OPTIONS'))
    expect(response.headers.has('Access-Control-Allow-Headers')).toBe(false)
    expect(response.headers.has('Access-Control-Max-Age')).toBe(false)
  })

  it.each([
    [undefined, { 'Access-Control-Request-Method': 'GET' }, 'OPTIONS'],
    ['https://app.test', {}, 'OPTIONS'],
    ['https://app.test', { 'Access-Control-Request-Method': 'GET' }, 'GET'],
    ['https://other.test', { 'Access-Control-Request-Method': 'GET' }, 'OPTIONS'],
  ] as const)('only handles OPTIONS with an allowed origin and requested method: %s %j %s', async (origin, headers, method) => {
    const next = vi.fn(() => new Response('handler', { status: 202 }))
    const response = await toFetch(cors({ origin: 'https://app.test' })(next)).fetch(request(origin, headers, method))
    expect(next).toHaveBeenCalledOnce()
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('handler')
  })
})
