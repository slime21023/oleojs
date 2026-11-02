import { request as httpRequest } from 'node:http'
import { connect as http2Connect, createServer as createHttp2Server } from 'node:http2'
import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toFetch } from '../../src/fetch.ts'
import { bodyLimit } from '../../src/filters/index.ts'
import { type NodeListener, toNodeListener } from '../../src/node/listener.ts'
import { lazyRequest, normalizeMethod, normalizeUrl } from '../../src/node/request.ts'
import { PROPERTY_OPTIONS } from '../portable/arbitraries.ts'
import { closeServers, echoUrl, fetchable, listen, send, sendRaw, serve } from './helpers.ts'

afterEach(closeServers)

function create(init: Partial<Parameters<typeof lazyRequest>[0]> = {}): Request {
  return lazyRequest({
    url: 'http://example.test/a?b=1',
    method: 'POST',
    rawHeaders: ['X-A', '1', 'x-a', '2', 'Content-Type', 'text/plain'],
    signal: new AbortController().signal,
    body: { stream: () => new Response('hello').body!, read: async () => new TextEncoder().encode('hello') },
    ...init,
  })
}

// Outcome of an operation that may throw, so native and lazy results compare with toEqual.
function outcome(run: () => string): { value: string } | { error: string } {
  try {
    return { value: run() }
  } catch (error) {
    return { error: (error as Error).name }
  }
}

describe('lazy request object', () => {
  it('passes instanceof Request and reports the Request tag', () => {
    const request = create()
    expect(request).toBeInstanceOf(Request)
    expect(Object.prototype.toString.call(request)).toBe('[object Request]')
  })

  it('answers method, url, headers, and signal without building the native request', () => {
    const signal = new AbortController().signal
    const stream = vi.fn(() => new Response('').body!)
    const read = vi.fn(async () => new Uint8Array())
    const request = create({ signal, body: { stream, read } })
    expect([request.method, request.url, request.headers.get('x-a'), request.signal]).toEqual([
      'POST',
      'http://example.test/a?b=1',
      '1, 2',
      signal,
    ])
    expect(request.headers).toBe(request.headers)
    expect(stream).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })

  it('delegates other members to a native request built once', async () => {
    const native = new Request('http://example.test/a?b=1', { method: 'POST' })
    const request = create()
    expect([request.mode, request.cache, request.credentials, request.redirect, request.keepalive]).toEqual([
      native.mode,
      native.cache,
      native.credentials,
      native.redirect,
      native.keepalive,
    ])
    expect(request.bodyUsed).toBe(false)
    expect(await request.text()).toBe('hello')
    expect(request.bodyUsed).toBe(true)
    await expect(request.text()).rejects.toThrow(TypeError)
  })

  it('carries header changes made before the native request exists', async () => {
    const request = create()
    request.headers.set('x-b', 'new')
    const copy = request.clone()
    expect(copy).toBeInstanceOf(Request)
    expect([copy.method, copy.url, copy.headers.get('x-b'), await copy.text()]).toEqual([
      'POST',
      'http://example.test/a?b=1',
      'new',
      'hello',
    ])
  })

  it('reads the body directly with text, json, arrayBuffer, and bytes, like a native request', async () => {
    // A view into a larger buffer, as Buffer.concat can return for small bodies.
    const pooled = new Uint8Array([0, ...new TextEncoder().encode('{"a":"é"}'), 0]).subarray(1, -1)
    const read = vi.fn(async () => pooled)
    const stream = vi.fn(() => new Response('').body!)
    const make = () => create({ body: { stream, read } })
    const native = () => new Request('http://example.test/', { method: 'POST', body: '{"a":"é"}' })
    expect(await make().text()).toBe(await native().text())
    expect(await make().json()).toEqual(await native().json())
    const buffer = await make().arrayBuffer()
    expect([buffer.byteLength, new Uint8Array(buffer)]).toEqual([pooled.byteLength, new Uint8Array(await native().arrayBuffer())])
    const bytes = await make().bytes()
    expect([bytes.buffer.byteLength, bytes]).toEqual([pooled.byteLength, await native().bytes()])
    expect(stream).not.toHaveBeenCalled()
  })

  it('treats a directly read body as used, like a native request', async () => {
    const request = create()
    expect(await request.json().catch((error: Error) => error.name)).toBe('SyntaxError')
    expect(request.bodyUsed).toBe(true)
    await expect(request.text()).rejects.toThrow(TypeError)
    await expect(request.blob()).rejects.toThrow(TypeError)
    expect(() => request.clone()).toThrow(TypeError)
    expect(request.body).not.toBeNull()
  })

  it('reads through the native request once it exists', async () => {
    const read = vi.fn(async () => new Uint8Array())
    const request = create({ body: { stream: () => new Response('streamed').body!, read } })
    expect(request.body).not.toBeNull()
    expect(await request.text()).toBe('streamed')
    expect(read).not.toHaveBeenCalled()
  })

  it('has a null body and never calls the body factory without one', async () => {
    const request = create({ method: 'GET', body: null })
    expect(request.body).toBeNull()
    expect(await request.text()).toBe('')
  })

  it('throws a TypeError where a native request is required (documented limitation)', () => {
    const request = create()
    expect(() => new Request(request)).toThrow(TypeError)
    expect(new Request(request.url, { method: request.method, headers: request.headers }).url).toBe(request.url)
    // The documented workaround: clone() returns a native Request that native APIs accept.
    expect(new Request(request.clone(), { headers: { 'x-c': '1' } }).method).toBe('POST')
  })
})

describe('normalization matches the Request constructor', () => {
  const hostArbitrary = fc.oneof(
    fc.constantFrom('example.test', 'EXAMPLE.test', '127.0.0.1', '127.1', '0x7f.1', 'a.0x', 'xn--nxasmq6b', 'xn--a', 'a..b'),
    fc.array(fc.constantFrom('a', 'Z', '0', '9', '-', '.', '_', 'é', '[', ']', ':'), { minLength: 1, maxLength: 12 })
      .map((characters) => characters.join('')),
    fc.tuple(fc.constantFrom('example.test', '127.0.0.1', 'localhost'), fc.constantFrom('', ':21', ':80', ':443', ':8080', ':0', ':080', ':65535', ':65536', ':99999', ':'))
      .map(([name, port]) => name + port),
  )
  const anyTargetArbitrary = fc
    .array(fc.constantFrom('a', 'B', '0', '/', '.', '..', '%', '2', 'e', 'E', '?', '=', '&', ' ', "'", '"', '<', '>', '`', '{', '}', '^', '|', '\\', '[', ']', 'é', '中', ':', '@', '~', '!', '*', '\t'), { maxLength: 16 })
    .map((characters) => `/${characters.join('')}`)
  // Only characters the fast path accepts, so dot segments and encoded dots reach it.
  const simpleTargetArbitrary = fc
    .array(fc.constantFrom('a', '/', '.', '..', '%2e', '%2E', '%2f', '?', '=', '~'), { maxLength: 10 })
    .map((characters) => `/${characters.join('')}`)
  const targetArbitrary = fc.oneof(anyTargetArbitrary, simpleTargetArbitrary)

  it('produces the URL that new Request reports, or throws when it throws', () => {
    fc.assert(
      fc.property(fc.constantFrom('http', 'https', 'ftp', 'foo'), hostArbitrary, targetArbitrary, (scheme, host, target) => {
        expect(outcome(() => normalizeUrl(scheme, host, target))).toEqual(
          outcome(() => new Request(`${scheme}://${host}${target}`).url),
        )
      }),
      PROPERTY_OPTIONS,
    )
  })

  it('handles absolute-form targets and rejects credentials like new Request', () => {
    for (const target of ['http://other.test/x', 'HTTP://Other.test:80/./x', 'http://u:p@other.test/', '*', 'other.test:443']) {
      expect(outcome(() => normalizeUrl('http', undefined, target))).toEqual(outcome(() => new Request(target).url))
    }
  })

  it('normalizes methods like new Request', () => {
    const methodArbitrary = fc.oneof(
      fc.constantFrom('get', 'Post', 'pUt', 'delete', 'HEAD', 'options', 'patch', 'PATCH', 'M-SEARCH', 'a b', ''),
      fc.array(fc.constantFrom('g', 'E', 't', '-', '!', ' ', '(', 'é'), { minLength: 1, maxLength: 8 }).map((characters) => characters.join('')),
    )
    fc.assert(
      fc.property(methodArbitrary, (method) => {
        // The adapter answers 501 to these before building a request.
        fc.pre(!['CONNECT', 'TRACE', 'TRACK'].includes(method.toUpperCase()))
        expect(outcome(() => normalizeMethod(method))).toEqual(
          outcome(() => new Request('http://x.test/', { method }).method),
        )
      }),
      PROPERTY_OPTIONS,
    )
  })
})

describe.each([{ lazyRequest: true }, { lazyRequest: false }])('toNodeListener with %o', (mode) => {
    it('builds the URL from the scheme, Host, and request target', async () => {
      const port = await serve(echoUrl, mode)
      expect((await send(port, 'GET', '/a/b?c=1')).body).toBe(`http://127.0.0.1:${port}/a/b?c=1`)
      expect((await send(port, 'GET', '/a/./b/../c', { host: 'EXAMPLE.test:80' })).body).toBe('http://example.test/a/c')
    })

    it('accepts absolute-form request targets', async () => {
      const port = await serve(echoUrl, mode)
      const reply = await sendRaw(port, 'GET http://other.test/x HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
      expect(reply).toMatch(/^HTTP\/1\.1 200/)
      expect(reply).toContain('http://other.test/x')
    })

    it('uses X-Forwarded-* only when trustProxy is set', async () => {
      const proxied = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'public.test' }
      const direct = await serve(echoUrl, mode)
      expect((await send(direct, 'GET', '/x', proxied)).body).toBe(`http://127.0.0.1:${direct}/x`)
      const trusted = await serve(echoUrl, { ...mode, trustProxy: true })
      expect((await send(trusted, 'GET', '/x', proxied)).body).toBe('https://public.test/x')
    })

    it('preserves duplicate headers', async () => {
      const port = await serve(fetchable((request) => new Response(request.headers.get('x-a'))), mode)
      expect((await send(port, 'GET', '/', { 'x-a': ['1', '2'] })).body).toBe('1, 2')
    })

    it('streams request bodies and reads them with body methods', async () => {
      const port = await serve(fetchable(async (request) => new Response(request.headers.has('x-text') ? await request.text() : request.body)), mode)
      const body = 'x'.repeat(1024 * 1024)
      expect((await send(port, 'POST', '/', {}, body)).body).toBe(body)
      expect((await send(port, 'POST', '/', { 'x-text': '1' }, 'small')).body).toBe('small')
    })

    it('discards an unread request body so the connection serves the next request', async () => {
      const port = await serve(fetchable(() => new Response('ignored')), mode)
      for (let i = 0; i < 2; i++) {
        expect((await send(port, 'POST', '/', {}, 'x'.repeat(4 * 1024 * 1024))).body).toBe('ignored')
      }
      expect((await send(port, 'GET', '/')).body).toBe('ignored')
    })

    it('rejects a direct read still running when the response finishes, instead of truncating it', async () => {
      let read: Promise<string> | undefined
      const port = await serve(fetchable((request) => {
        read = request.text().then(() => 'resolved', (error: Error) => error.message)
        return new Response('early')
      }), mode)
      expect((await send(port, 'POST', '/', {}, 'x'.repeat(4 * 1024 * 1024))).body).toBe('early')
      expect(await read).toBe('Request body discarded after the response')
      expect((await send(port, 'GET', '/')).body).toBe('early')
    })

    it('works with bodyLimit, which passes on a native request', async () => {
      let passedOn: Request | undefined
      const app = toFetch(bodyLimit({ maxBytes: 1024 })(async (request) => ((passedOn = request), new Response(await request.text()))))
      const port = await serve(app, mode)
      expect((await send(port, 'POST', '/', {}, 'x'.repeat(4 * 1024 * 1024))).status).toBe(413)
      const accepted = await send(port, 'POST', '/p?q=1', { 'x-a': '1' }, 'x'.repeat(1024))
      expect([accepted.status, accepted.body.length]).toEqual([200, 1024])
      expect([passedOn?.method, passedOn?.url, passedOn?.headers.get('x-a')]).toEqual(['POST', `http://127.0.0.1:${port}/p?q=1`, '1'])
    })

    it.each([
      ['a Host that would change the path', 'GET /x HTTP/1.1\r\nHost: evil.test/admin\r\n'],
      ['a Host with userinfo', 'GET /x HTTP/1.1\r\nHost: user@evil.test\r\n'],
      ['an asterisk-form target', 'OPTIONS * HTTP/1.1\r\nHost: 127.0.0.1\r\n'],
      ['an absolute-form target with credentials', 'GET http://u:p@other.test/ HTTP/1.1\r\nHost: 127.0.0.1\r\n'],
      ['an invalid port', 'GET /x HTTP/1.1\r\nHost: 127.0.0.1:99999\r\n'],
    ])('responds 400 to %s, without calling the app', async (_, head) => {
      const fetch = vi.fn(async () => new Response())
      const port = await serve({ fetch }, mode)
      expect(await sendRaw(port, `${head}Connection: close\r\n\r\n`)).toMatch(/^HTTP\/1\.1 400/)
      expect(fetch).not.toHaveBeenCalled()
    })

    it('responds 501 to methods Fetch forbids, without calling the app', async () => {
      const fetch = vi.fn(async () => new Response())
      const port = await serve({ fetch }, mode)
      expect((await send(port, 'TRACE', '/')).status).toBe(501)
      expect(fetch).not.toHaveBeenCalled()
    })

    it('aborts request.signal when the client disconnects', async () => {
      let signal: AbortSignal | undefined
      const port = await serve(fetchable((request) => ((signal = request.signal), new Promise<Response>(() => {}))), mode)
      const req = httpRequest({ host: '127.0.0.1', port, path: '/' })
      req.on('error', () => {})
      req.end()
      await vi.waitFor(() => expect(signal).toBeDefined())
      expect(signal?.aborted).toBe(false)
      req.destroy()
      await vi.waitFor(() => expect(signal?.aborted).toBe(true))
    })

    it('maps HTTP/2 pseudo-headers', async () => {
      let seen: { url: string; headers: string[] } | undefined
      const app = fetchable((request) => {
        seen = { url: request.url, headers: [...request.headers.keys()] }
        return new Response('h2')
      })
      const port = await listen(createHttp2Server(toNodeListener(app, mode) as Parameters<typeof createHttp2Server>[0] & NodeListener))
      const client = http2Connect(`http://127.0.0.1:${port}`)
      const body = await new Promise<string>((resolve, reject) => {
        const stream = client.request({ ':path': '/x?y=1', 'x-a': '1' })
        let text = ''
        stream.setEncoding('utf8')
        stream.on('data', (chunk: string) => (text += chunk))
        stream.on('end', () => resolve(text))
        stream.on('error', reject)
        stream.end()
      })
      client.close()
      expect(body).toBe('h2')
      expect(seen?.url).toBe(`http://127.0.0.1:${port}/x?y=1`)
      expect(seen?.headers.some((name) => name.startsWith(':'))).toBe(false)
      expect(seen?.headers).toContain('x-a')
    })
})
