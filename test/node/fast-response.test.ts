import { request as httpRequest } from 'node:http'
import { connect as http2Connect, createServer as createHttp2Server } from 'node:http2'
import fc from 'fast-check'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toFetch } from '../../src/fetch.ts'
import { cors, responseHeaders } from '../../src/filters/index.ts'
import { FastResponse } from '../../src/node/index.ts'
import { type NodeListener, toNodeListener } from '../../src/node/listener.ts'
import { PROPERTY_OPTIONS } from '../portable/arbitraries.ts'
import { closeServers, fetchable, listen, send, serve } from './helpers.ts'

afterEach(closeServers)

type Snapshot = { error: string } | { status: number; statusText: string; ok: boolean; headers: [string, string][]; text: string }

// Everything observable about a response, so native and fast responses compare with toEqual.
async function snapshot(create: () => Response): Promise<Snapshot> {
  let response: Response
  try {
    response = create()
  } catch (error) {
    return { error: (error as Error).name }
  }
  const { status, statusText, ok } = response
  const headers = [...response.headers]
  return { status, statusText, ok, headers, text: await response.text() }
}

describe('FastResponse object', () => {
  it('passes instanceof Response', () => {
    expect(new FastResponse('x')).toBeInstanceOf(Response)
    expect(FastResponse.json({})).toBeInstanceOf(Response)
  })

  it('constructs, validates, and reads like Response', async () => {
    const bodies = [null, undefined, '', 'text', 'é中', new Uint8Array([104, 105])]
    const statuses = [undefined, 0, 101, 199, 200, 201, 204, 205, 304, 404, 599, 600, 65736, 200.9, '201', Number.NaN]
    const statusTexts = [undefined, '', 'OK', 'Made Up', 'tab\tok', 'bad\nline', 'é', '中']
    const headers = [undefined, { 'X-A': '1' }, { 'Content-Type': 'text/html' }, [['Set-Cookie', 'a=1'], ['Set-Cookie', 'b=2']], [['bad name', 'x']], { 'x-b': 'bad\nvalue' }]
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...bodies), fc.constantFrom(...statuses), fc.constantFrom(...statusTexts), fc.constantFrom(...headers), async (body, status, statusText, headerInit) => {
        const init = { status, statusText, headers: headerInit } as ResponseInit
        expect(await snapshot(() => new FastResponse(body, init))).toEqual(await snapshot(() => new Response(body, init)))
      }),
      PROPERTY_OPTIONS,
    )
  })

  it('serializes JSON like Response.json', async () => {
    const values = [{ a: 1 }, [1, 'x'], 'text', null, 0, undefined, 1n, () => {}]
    const inits: (ResponseInit | undefined)[] = [undefined, { status: 201 }, { headers: { 'Content-Type': 'application/vnd.test+json' } }, { headers: { 'X-A': '1' } }]
    for (const value of values) {
      for (const init of inits) {
        expect(await snapshot(() => FastResponse.json(value, init))).toEqual(await snapshot(() => Response.json(value, init)))
      }
    }
  })

  it('reads body members through a native response built once', async () => {
    const response = new FastResponse('hello')
    expect(response.bodyUsed).toBe(false)
    const copy = response.clone()
    expect(await response.text()).toBe('hello')
    expect([response.bodyUsed, await copy.text()]).toEqual([true, 'hello'])
    await expect(response.text()).rejects.toThrow(TypeError)
  })

  it('keeps header changes made before the body is read', async () => {
    const response = new FastResponse('x')
    response.headers.set('x-a', '1')
    expect([...response.clone().headers]).toEqual([['content-type', 'text/plain;charset=UTF-8'], ['x-a', '1']])
  })
})

describe('toNodeListener with FastResponse', () => {
  it('writes status, headers, and Content-Length in one response without chunking', async () => {
    const port = await serve(fetchable(() => new FastResponse('é中', { status: 201, statusText: 'Made', headers: { 'X-A': '1' } })))
    const reply = await send(port, 'GET', '/')
    expect([reply.status, reply.statusMessage, reply.body]).toEqual([201, 'Made', 'é中'])
    expect(reply.headers).toMatchObject({ 'x-a': '1', 'content-length': '5' })
    expect(reply.headers['transfer-encoding']).toBeUndefined()
  })

  it('writes the default Content-Type for text and JSON', async () => {
    const port = await serve(fetchable((request) => (request.url.endsWith('/json') ? FastResponse.json({ a: 1 }) : new FastResponse('t'))))
    const text = await send(port, 'GET', '/text')
    const json = await send(port, 'GET', '/json')
    expect([text.headers['content-type'], text.headers['content-length'], text.body]).toEqual(['text/plain;charset=UTF-8', '1', 't'])
    expect([json.headers['content-type'], json.headers['content-length'], json.body]).toEqual(['application/json', '7', '{"a":1}'])
  })

  it('writes byte bodies, null bodies, and HEAD responses', async () => {
    const port = await serve(fetchable((request) => (request.url.endsWith('/empty') ? new FastResponse(null, { status: 204 }) : new FastResponse(new Uint8Array([104, 105])))))
    const bytes = await send(port, 'GET', '/bytes')
    expect([bytes.headers['content-length'], bytes.headers['content-type'], bytes.body]).toEqual(['2', undefined, 'hi'])
    const empty = await send(port, 'GET', '/empty')
    expect([empty.status, empty.body]).toEqual([204, ''])
    const head = await send(port, 'HEAD', '/bytes')
    expect([head.headers['content-length'], head.body]).toEqual(['2', ''])
  })

  it('writes each Set-Cookie value separately and keeps an explicit Content-Length', async () => {
    const port = await serve(fetchable(() => new FastResponse('abc', { headers: [['Set-Cookie', 'a=1'], ['Set-Cookie', 'b=2, c'], ['Content-Length', '3']] })))
    const reply = await send(port, 'GET', '/')
    expect([reply.headers['set-cookie'], reply.headers['content-length'], reply.body]).toEqual([['a=1', 'b=2, c'], '3', 'abc'])
  })

  it('streams bodies it cannot write at once, and responses whose body was read', async () => {
    const stream = () => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('st'))
        controller.enqueue(new TextEncoder().encode('ream'))
        controller.close()
      },
    })
    const port = await serve(fetchable((request) => {
      if (request.url.endsWith('/stream')) return new FastResponse(stream())
      const response = new FastResponse('cloned')
      void response.clone()
      return response
    }))
    expect((await send(port, 'GET', '/stream')).body).toBe('stream')
    expect((await send(port, 'GET', '/read')).body).toBe('cloned')
  })

  it('works with filters that rebuild the response', async () => {
    const app = toFetch(cors({ origin: '*' })(responseHeaders({ 'x-b': '2' })(() => new FastResponse('ok'))))
    const port = await serve(app)
    const reply = await send(port, 'GET', '/', { origin: 'https://app.test' })
    expect([reply.body, reply.headers['x-b'], reply.headers['access-control-allow-origin']]).toEqual(['ok', '2', '*'])
  })

  it('writes nothing and reports nothing when the client is gone', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    let finish: ((response: Response) => void) | undefined
    let signal: AbortSignal | undefined
    const port = await serve(fetchable((request) => {
      signal = request.signal
      return new Promise<Response>((resolve) => (finish = resolve))
    }))
    const req = httpRequest({ host: '127.0.0.1', port, path: '/' })
    req.on('error', () => {})
    req.end()
    await vi.waitFor(() => expect(finish).toBeDefined())
    req.destroy()
    await vi.waitFor(() => expect(signal?.aborted).toBe(true))
    finish!(new FastResponse('late'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(report).not.toHaveBeenCalled()
    report.mockRestore()
  })

  it('drops connection-specific headers on HTTP/2', async () => {
    const app = fetchable(() => new FastResponse('h2', { headers: { Connection: 'keep-alive', 'X-B': '2' } }))
    const port = await listen(createHttp2Server(toNodeListener(app) as Parameters<typeof createHttp2Server>[0] & NodeListener))
    const client = http2Connect(`http://127.0.0.1:${port}`)
    const reply = await new Promise<{ headers: Record<string, unknown>; body: string }>((resolve, reject) => {
      const stream = client.request({ ':path': '/' })
      let body = ''
      let headers: Record<string, unknown> = {}
      stream.setEncoding('utf8')
      stream.on('response', (h) => (headers = h))
      stream.on('data', (chunk: string) => (body += chunk))
      stream.on('end', () => resolve({ headers, body }))
      stream.on('error', reject)
      stream.end()
    })
    client.close()
    expect([reply.headers[':status'], reply.headers['x-b'], reply.headers.connection, reply.headers['content-length'], reply.body]).toEqual([200, '2', undefined, '2', 'h2'])
  })
})
