import { type IncomingHttpHeaders, type OutgoingHttpHeaders, createServer, request as httpRequest } from 'node:http'
import { connect as http2Connect, createServer as createHttp2Server } from 'node:http2'
import type { AddressInfo, Server } from 'node:net'
import { connect as netConnect } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { STUB_EXECUTION_CTX } from '../../src/context-defaults.ts'
import { toFetch } from '../../src/fetch.ts'
import { bodyLimit } from '../../src/filters/index.ts'
import type { ExecutionContext, FetchHandler } from '../../src/types.ts'
import { type NodeListener, type NodeListenerArgs, toNodeListener } from '../../src/node/listener.ts'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

async function listen(server: Server): Promise<number> {
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as AddressInfo).port
}

function serve<E>(app: FetchHandler<E>, ...options: NodeListenerArgs<E>): Promise<number> {
  return listen(createServer(toNodeListener(app, ...options)))
}

const fetchable = (fetch: (request: Request) => Response | Promise<Response>): FetchHandler => ({
  fetch: async (request) => fetch(request),
})

interface Reply {
  status: number
  statusMessage: string
  headers: IncomingHttpHeaders
  body: string
}

function send(port: number, method: string, path: string, headers: OutgoingHttpHeaders = {}, body?: string) {
  return new Promise<Reply>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => (text += chunk))
      res.on('end', () =>
        resolve({ status: res.statusCode!, statusMessage: res.statusMessage!, headers: res.headers, body: text }),
      )
    })
    req.on('error', reject)
    req.end(body)
  })
}

// Sends raw bytes, for request targets and headers that normal clients refuse to produce.
function sendRaw(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(port, '127.0.0.1', () => socket.end(text))
    let reply = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => (reply += chunk))
    socket.on('end', () => resolve(reply))
    socket.on('error', reject)
  })
}

const echoUrl = fetchable((request) => new Response(request.url))

describe('ingress', () => {
  it('builds the URL from the scheme, Host, and request target', async () => {
    const port = await serve(echoUrl)
    expect((await send(port, 'GET', '/a/b?c=1')).body).toBe(`http://127.0.0.1:${port}/a/b?c=1`)
  })

  it('preserves duplicate headers', async () => {
    const port = await serve(fetchable((request) => new Response(request.headers.get('x-a'))))
    expect((await send(port, 'GET', '/', { 'x-a': ['1', '2'] })).body).toBe('1, 2')
  })

  it('streams request bodies', async () => {
    const port = await serve(fetchable((request) => new Response(request.body)))
    const body = 'x'.repeat(1024 * 1024)
    expect((await send(port, 'POST', '/', {}, body)).body).toBe(body)
  })

  it('passes options.env and the executionCtx stub to any { fetch } object', async () => {
    let seen: [unknown, ExecutionContext | undefined] | undefined
    const app: FetchHandler<{ DB: string }> = {
      fetch: async (request, env, executionCtx) => ((seen = [env, executionCtx]), new Response()),
    }
    const port = await serve(app, { env: { DB: 'db' } })
    await send(port, 'GET', '/')
    expect(seen).toEqual([{ DB: 'db' }, STUB_EXECUTION_CTX])
  })

  it('discards an unread request body so the connection serves the next request', async () => {
    const port = await serve(fetchable(() => new Response('ignored')))
    for (let i = 0; i < 2; i++) {
      expect((await send(port, 'POST', '/', {}, 'x'.repeat(4 * 1024 * 1024))).body).toBe('ignored')
    }
    expect((await send(port, 'GET', '/')).body).toBe('ignored')
  })

  it('delivers the 413 when bodyLimit cancels an oversized body mid-stream', async () => {
    const app = toFetch(bodyLimit({ maxBytes: 1024 })(async (request) => new Response(await request.text())))
    const port = await serve(app)
    const tooLarge = await send(port, 'POST', '/', {}, 'x'.repeat(4 * 1024 * 1024))
    expect(tooLarge.status).toBe(413)
    const accepted = await send(port, 'POST', '/', {}, 'x'.repeat(1024))
    expect([accepted.status, accepted.body.length]).toEqual([200, 1024])
  })

  it('requires options.env exactly when the application needs an environment', () => {
    const envApp: FetchHandler<{ DB: string }> = { fetch: async () => new Response() }
    const optionalApp: FetchHandler<{ DB: string } | undefined> = { fetch: async () => new Response() }
    // @ts-expect-error -- the application needs an environment
    toNodeListener(envApp)
    // @ts-expect-error -- options without env are not enough
    toNodeListener(envApp, { trustProxy: true })
    // @ts-expect-error -- the environment must have the application's type
    toNodeListener(envApp, { env: { DB: 1 } })
    toNodeListener(envApp, { env: { DB: 'db' }, trustProxy: true })
    toNodeListener(optionalApp)
    toNodeListener(echoUrl, { trustProxy: true })
  })

  it('accepts absolute-form request targets', async () => {
    const port = await serve(echoUrl)
    const reply = await sendRaw(port, 'GET http://other.test/x HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
    expect(reply).toMatch(/^HTTP\/1\.1 200/)
    expect(reply).toContain('http://other.test/x')
  })
})

describe('proxy headers', () => {
  const proxied = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'public.test' }

  it('ignores X-Forwarded-* by default', async () => {
    const port = await serve(echoUrl)
    expect((await send(port, 'GET', '/x', proxied)).body).toBe(`http://127.0.0.1:${port}/x`)
  })

  it('uses X-Forwarded-Proto and X-Forwarded-Host when trustProxy is set', async () => {
    const port = await serve(echoUrl, { trustProxy: true })
    expect((await send(port, 'GET', '/x', proxied)).body).toBe('https://public.test/x')
    expect((await send(port, 'GET', '/x', { 'x-forwarded-proto': 'gopher, https' })).body).toBe(
      `http://127.0.0.1:${port}/x`,
    )
  })
})

describe('rejected requests', () => {
  it('responds 501 to methods Fetch forbids, without calling the app', async () => {
    const fetch = vi.fn(async () => new Response())
    const port = await serve({ fetch })
    expect((await send(port, 'TRACE', '/')).status).toBe(501)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['a Host that would change the path', 'GET /x HTTP/1.1\r\nHost: evil.test/admin\r\n'],
    ['a Host with userinfo', 'GET /x HTTP/1.1\r\nHost: user@evil.test\r\n'],
    ['an asterisk-form target', 'OPTIONS * HTTP/1.1\r\nHost: 127.0.0.1\r\n'],
  ])('responds 400 to %s, without calling the app', async (_, head) => {
    const fetch = vi.fn(async () => new Response())
    const port = await serve({ fetch })
    expect(await sendRaw(port, `${head}Connection: close\r\n\r\n`)).toMatch(/^HTTP\/1\.1 400/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('responds 400 to an unsafe X-Forwarded-Host when trustProxy is set', async () => {
    const port = await serve(echoUrl, { trustProxy: true })
    expect((await send(port, 'GET', '/x', { 'x-forwarded-host': 'evil.test/admin' })).status).toBe(400)
  })
})

describe('egress', () => {
  it('writes status, status text, and headers', async () => {
    const port = await serve(
      fetchable(() => new Response('ok', { status: 201, statusText: 'Made', headers: { 'X-A': '1' } })),
    )
    const reply = await send(port, 'GET', '/')
    expect([reply.status, reply.statusMessage, reply.headers['x-a'], reply.body]).toEqual([201, 'Made', '1', 'ok'])
  })

  it('falls back to the standard reason phrase when statusText is empty', async () => {
    const port = await serve(fetchable(() => new Response(null, { status: 201 })))
    expect((await send(port, 'GET', '/')).statusMessage).toBe('Created')
  })

  it('writes each Set-Cookie value separately', async () => {
    const headers = new Headers([['Set-Cookie', 'a=1'], ['Set-Cookie', 'b=2']])
    const port = await serve(fetchable(() => new Response(null, { headers })))
    expect((await send(port, 'GET', '/')).headers['set-cookie']).toEqual(['a=1', 'b=2'])
  })

  it('streams response bodies chunk by chunk', async () => {
    const chunks = ['a', 'b', 'c']
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift()
        if (chunk === undefined) controller.close()
        else controller.enqueue(new TextEncoder().encode(chunk))
      },
    })
    const port = await serve(fetchable(() => new Response(body)))
    expect((await send(port, 'GET', '/')).body).toBe('abc')
  })

  it('writes no body for HEAD and cancels the response body', async () => {
    let cancelled = false
    const port = await serve(
      fetchable(() => new Response(new ReadableStream({ cancel: () => void (cancelled = true) }))),
    )
    const reply = await send(port, 'HEAD', '/')
    expect(reply.body).toBe('')
    await vi.waitFor(() => expect(cancelled).toBe(true))
  })
})

describe('errors and aborts', () => {
  it.each(['throw', 'reject'])('reports HEAD cancellation failures and responds 500 (%s)', async (mode) => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('cancel failed')
    try {
      const port = await serve(fetchable(() => new Response(new ReadableStream({
        cancel() {
          if (mode === 'throw') throw error
          return Promise.reject(error)
        },
      }))))
      const reply = await send(port, 'HEAD', '/')
      expect([reply.status, reply.body]).toEqual([500, ''])
      expect(report).toHaveBeenCalledWith(error)
    } finally {
      report.mockRestore()
    }
  })

  it('reports cancellation failures of a response returned after the client disconnects', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('late cancel failed')
    const cancelled = vi.fn(() => Promise.reject(error))
    let finish: ((response: Response) => void) | undefined
    let signal: AbortSignal | undefined
    try {
      const port = await serve(fetchable((request) => {
        signal = request.signal
        return new Promise<Response>((resolve) => { finish = resolve })
      }))
      const req = httpRequest({ host: '127.0.0.1', port, path: '/' })
      req.on('error', () => {})
      req.end()
      await vi.waitFor(() => expect(finish).toBeDefined())
      req.destroy()
      await vi.waitFor(() => expect(signal?.aborted).toBe(true))
      finish!(new Response(new ReadableStream({ cancel: cancelled })))
      await vi.waitFor(() => expect(report).toHaveBeenCalledWith(error))
      expect(cancelled).toHaveBeenCalledTimes(1)
    } finally {
      report.mockRestore()
    }
  })

  it('responds 500 and reports the error when the app rejects', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('boom')
    const port = await serve(fetchable(() => Promise.reject(error)))
    const reply = await send(port, 'GET', '/')
    expect([reply.status, reply.body]).toEqual([500, ''])
    expect(report).toHaveBeenCalledWith(error)
    report.mockRestore()
  })

  it('destroys the socket when the body fails after headers are sent', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('partial'))
        setTimeout(() => controller.error(new Error('mid-stream')), 10)
      },
    })
    const port = await serve(fetchable(() => new Response(body)))
    const complete = await new Promise<boolean>((resolve) => {
      httpRequest({ host: '127.0.0.1', port, path: '/' }, (res) => {
        res.resume()
        res.on('close', () => resolve(res.complete))
      })
        .on('error', () => resolve(false))
        .end()
    })
    expect(complete).toBe(false)
    // The client can see the socket close before the server's pipeline callback runs.
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'mid-stream' })))
    report.mockRestore()
  })

  it('aborts request.signal and cancels the response body when the client disconnects', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    let signal: AbortSignal | undefined
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => new Promise((resolve) => setTimeout(resolve, 5)).then(() => controller.enqueue(new Uint8Array(1))),
      cancel: () => void (cancelled = true),
    })
    const port = await serve(fetchable((request) => ((signal = request.signal), new Response(body))))
    const req = httpRequest({ host: '127.0.0.1', port, path: '/' }, (res) => res.once('data', () => req.destroy()))
    req.on('error', () => {})
    req.end()
    await vi.waitFor(() => expect([signal?.aborted, cancelled]).toEqual([true, true]))
    expect(report).not.toHaveBeenCalled()
    report.mockRestore()
  })
})

describe('HTTP/2', () => {
  it('maps pseudo-headers and drops connection-specific response headers', async () => {
    let seen: { url: string; headers: string[] } | undefined
    const app = fetchable((request) => {
      seen = { url: request.url, headers: [...request.headers.keys()] }
      return new Response('h2', { headers: { Connection: 'keep-alive', 'X-B': '2' } })
    })
    const port = await listen(createHttp2Server(toNodeListener(app) as Parameters<typeof createHttp2Server>[0] & NodeListener))
    const client = http2Connect(`http://127.0.0.1:${port}`)
    const reply = await new Promise<{ headers: Record<string, unknown>; body: string }>((resolve, reject) => {
      const stream = client.request({ ':path': '/x?y=1', 'x-a': '1' })
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
    expect(seen?.url).toBe(`http://127.0.0.1:${port}/x?y=1`)
    expect(seen?.headers.some((name) => name.startsWith(':'))).toBe(false)
    expect(seen?.headers).toContain('x-a')
    expect([reply.headers[':status'], reply.headers['x-b'], reply.headers.connection, reply.body]).toEqual([
      200,
      '2',
      undefined,
      'h2',
    ])
  })
})
