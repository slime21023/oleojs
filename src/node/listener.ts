import type { IncomingMessage, ServerResponse } from 'node:http'
import { Http2ServerRequest, Http2ServerResponse } from 'node:http2'
import { Readable, pipeline } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { STUB_EXECUTION_CTX } from '../fetch.ts'
import { FORBIDDEN_METHODS } from '../router.ts'
import type { FetchHandler } from '../types.ts'

export interface NodeListenerOptions<E = unknown> {
  env?: E
  // Take the scheme and host from X-Forwarded-Proto / X-Forwarded-Host. Enable only behind
  // a proxy that always sets or strips them.
  trustProxy?: boolean
}

export type NodeRequest = IncomingMessage | Http2ServerRequest
export type NodeResponse = ServerResponse | Http2ServerResponse
export type NodeListener = (req: NodeRequest, res: NodeResponse) => void

// Connection-specific headers are invalid in HTTP/2 responses.
const HTTP2_CONNECTION_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade'])
// Characters that would let a Host value change the path or authority of the request URL.
const UNSAFE_HOST = /[/\\?#@\s]/

export function toNodeListener<E>(app: FetchHandler<E>, options: NodeListenerOptions<E> = {}): NodeListener {
  const { env, trustProxy = false } = options
  return (req, res) => {
    void handle(app, env, trustProxy, req, res)
  }
}

async function handle<E>(
  app: FetchHandler<E>,
  env: E | undefined,
  trustProxy: boolean,
  req: NodeRequest,
  res: NodeResponse,
): Promise<void> {
  const controller = new AbortController()
  res.once('close', () => {
    if (!res.writableEnded) controller.abort()
  })

  if (FORBIDDEN_METHODS.has((req.method ?? '').toUpperCase())) return respondEmpty(res, 501)
  let request: Request
  try {
    request = toRequest(req, trustProxy, controller.signal)
  } catch {
    return respondEmpty(res, 400)
  }

  try {
    const response = await app.fetch(request, env, STUB_EXECUTION_CTX)
    await writeResponse(response, req, res, controller.signal)
  } catch (error) {
    console.error(error)
    if (res.destroyed) return
    if (!res.headersSent) respondEmpty(res, 500)
    else res.destroy(error instanceof Error ? error : undefined)
  }
}

function firstValue(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header
  return value?.split(',')[0]?.trim() || undefined
}

function toRequest(req: NodeRequest, trustProxy: boolean, signal: AbortSignal): Request {
  const http2 = req instanceof Http2ServerRequest
  let scheme = http2 ? req.scheme : 'encrypted' in req.socket && req.socket.encrypted === true ? 'https' : 'http'
  let host = http2 ? req.authority : req.headers.host
  if (trustProxy) {
    const proto = firstValue(req.headers['x-forwarded-proto'])?.toLowerCase()
    if (proto === 'http' || proto === 'https') scheme = proto
    host = firstValue(req.headers['x-forwarded-host']) ?? host
  }

  // Origin-form targets are joined with the host; anything else (absolute-form, or an
  // unsupported form such as `*`) is left to the Request constructor to accept or reject.
  const target = req.url ?? ''
  let url = target
  if (target.startsWith('/')) {
    if (host === undefined || host === '' || UNSAFE_HOST.test(host)) throw new TypeError(`Invalid host: ${host}`)
    url = `${scheme}://${host}${target}`
  }

  const headers = new Headers()
  const raw = req.rawHeaders
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i]!
    if (!name.startsWith(':')) headers.append(name, raw[i + 1]!)
  }

  const method = req.method ?? 'GET'
  const body = method === 'GET' || method === 'HEAD' ? null : (Readable.toWeb(req as Readable) as unknown as ReadableStream)
  // `duplex` is required by Node for streaming request bodies but missing from the DOM types.
  const init: RequestInit & { duplex: 'half' } = { method, headers, body, signal, duplex: 'half' }
  return new Request(url, init)
}

function respondEmpty(res: NodeResponse, status: number): void {
  if (res instanceof Http2ServerResponse) res.writeHead(status)
  else res.writeHead(status)
  res.end()
}

async function writeResponse(response: Response, req: NodeRequest, res: NodeResponse, signal: AbortSignal): Promise<void> {
  const body = response.body
  if (signal.aborted) {
    await body?.cancel()
    return
  }
  if (req.method === 'HEAD') {
    // Finish cleanup before committing headers so failures can still become a 500.
    await body?.cancel()
    if (signal.aborted) return
  }

  const http2 = res instanceof Http2ServerResponse
  const headers: Record<string, string | string[]> = {}
  for (const [name, value] of response.headers) {
    if (name !== 'set-cookie' && !(http2 && HTTP2_CONNECTION_HEADERS.has(name))) headers[name] = value
  }
  const cookies = response.headers.getSetCookie()
  if (cookies.length > 0) headers['set-cookie'] = cookies

  if (res instanceof Http2ServerResponse) res.writeHead(response.status, headers)
  else if (response.statusText !== '') res.writeHead(response.status, response.statusText, headers)
  else res.writeHead(response.status, headers)

  if (body === null || req.method === 'HEAD') {
    res.end()
    return
  }

  return new Promise((resolve, reject) => {
    pipeline(Readable.fromWeb(body as unknown as NodeReadableStream), res, (error) => {
      // A client disconnect surfaces as a premature close; that is not a server error. Do not
      // test `signal.aborted` here: a failing body also destroys `res`, which aborts the signal.
      if (error && (error as { code?: unknown }).code !== 'ERR_STREAM_PREMATURE_CLOSE') reject(error)
      else resolve()
    })
  })
}
