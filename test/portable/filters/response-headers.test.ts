import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { responseHeaders } from '../../../src/filters/index.ts'
import { toFetch, withFilters } from '../../../src/index.ts'
import { PROPERTY_OPTIONS } from '../arbitraries.ts'

const request = () => new Request('https://api.test/')

describe('responseHeaders', () => {
  it.each([undefined, null, 42, 'header', { 'bad name': 'value' }, { 'X-Value': 'bad\nvalue' }, [['X-Value']]])(
    'rejects missing or invalid headers at construction: %j', (headers) => {
      expect(() => responseHeaders(headers as HeadersInit)).toThrow(TypeError)
    },
  )

  it('overrides matching names without changing original headers or response metadata', async () => {
    const original = new Response('body', { status: 201, statusText: 'Created here', headers: { 'X-Override': 'old', 'X-Keep': 'kept' } })
    const app = toFetch(withFilters(() => original, responseHeaders({ 'x-override': 'new', 'X-Added': 'added' })))
    const response = await app.fetch(request())
    expect(response).not.toBe(original)
    expect(response.status).toBe(201)
    expect(response.statusText).toBe('Created here')
    expect(response.headers.get('X-Override')).toBe('new')
    expect(response.headers.get('X-Keep')).toBe('kept')
    expect(response.headers.get('X-Added')).toBe('added')
    expect(original.headers.get('X-Override')).toBe('old')
    expect(original.headers.has('X-Added')).toBe(false)
    expect(await response.text()).toBe('body')
  })

  it.each(['record', 'pairs', 'headers'] as const)('snapshots configured %s and isolates later responses', async (kind) => {
    const record = { 'X-App': 'original' }
    const pairs: [string, string][] = [['X-App', 'original']]
    const headers = new Headers(record)
    const configured = kind === 'record' ? record : kind === 'pairs' ? pairs : headers
    const app = toFetch(withFilters(() => new Response(), responseHeaders(configured)))
    record['X-App'] = 'changed'
    pairs[0][1] = 'changed'
    headers.set('X-App', 'changed')
    const first = await app.fetch(request())
    expect(first.headers.get('X-App')).toBe('original')
    first.headers.set('X-App', 'changed response')
    expect((await app.fetch(request())).headers.get('X-App')).toBe('original')
  })

  it('preserves all replacement cookies and unrelated cookies when no replacement is configured', async () => {
    const source = new Headers([['Set-Cookie', 'old=1; Path=/'], ['Set-Cookie', 'keep=2; Path=/']])
    const replace = toFetch(withFilters(() => new Response(null, { headers: source }), responseHeaders([
      ['Set-Cookie', 'new=3; Path=/'], ['Set-Cookie', 'other=4; Path=/'],
    ])))
    expect((await replace.fetch(request())).headers.getSetCookie()).toEqual(['new=3; Path=/', 'other=4; Path=/'])
    const keep = toFetch(withFilters(() => new Response(null, { headers: source }), responseHeaders({ 'X-App': 'oleo' })))
    expect((await keep.fetch(request())).headers.getSetCookie()).toEqual(['old=1; Path=/', 'keep=2; Path=/'])
    expect(source.getSetCookie()).toEqual(['old=1; Path=/', 'keep=2; Path=/'])
  })

  it('supports immutable native response headers', async () => {
    const original = Response.redirect('https://other.test/')
    const response = await toFetch(withFilters(() => original, responseHeaders({ 'X-App': 'oleo' }))).fetch(request())
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('https://other.test/')
    expect(original.headers.has('X-App')).toBe(false)
  })

  it.each([204, 304, 401, 500])('keeps null bodies at status %s', async (status) => {
    const response = await toFetch(withFilters(() => new Response(null, { status }), responseHeaders({ 'X-App': 'oleo' }))).fetch(request())
    expect(response.status).toBe(status)
    expect(response.body).toBeNull()
  })

  it('passes network-error responses through', async () => {
    const original = Response.error()
    const response = await toFetch(withFilters(() => original, responseHeaders({ 'X-App': 'oleo' }))).fetch(request())
    expect(response).toBe(original)
  })

  it('returns before a streaming body closes and preserves its bytes', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const original = new Response(new ReadableStream({ start(value) { controller = value } }))
    const response = await toFetch(withFilters(() => original, responseHeaders({ 'X-App': 'oleo' }))).fetch(request())
    expect(response.bodyUsed).toBe(false)
    controller?.enqueue(new Uint8Array([0, 1, 127, 255]))
    controller?.close()
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0, 1, 127, 255]))
  })

  it('preserves generated bodies and unaffected headers while replacing configured values', async () => {
    const value = fc.array(fc.constantFrom('a', 'b', '0', '-', '_'), { maxLength: 30 }).map((parts) => parts.join(''))
    await fc.assert(fc.asyncProperty(value, value, fc.uint8Array({ maxLength: 100 }), async (replace, keep, body) => {
      const original = new Response(new Uint8Array(body), { status: 202, headers: { 'X-Replace': 'old', 'X-Keep': keep } })
      const response = await toFetch(withFilters(() => original, responseHeaders({ 'X-Replace': replace }))).fetch(request())
      expect(response.status).toBe(202)
      expect(response.headers.get('X-Replace')).toBe(replace)
      expect(response.headers.get('X-Keep')).toBe(keep)
      expect(original.headers.get('X-Replace')).toBe('old')
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(body)
    }), PROPERTY_OPTIONS)
  })
})
