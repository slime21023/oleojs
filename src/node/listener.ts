import type { IncomingMessage, ServerResponse } from 'node:http'
import { Http2ServerRequest, Http2ServerResponse } from 'node:http2'
import { Readable, pipeline } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { STUB_EXECUTION_CTX } from '../context-defaults.ts'
import { FORBIDDEN_METHODS } from '../http-method.ts'
import type { FetchArgs, FetchHandler } from '../types.ts'

/**
 * Application data and proxy handling for the Node.js adapter.
 * `env` is required when the application's environment cannot be `undefined`.
 */
export type NodeListenerOptions<E = unknown> = {
  /**
   * Use the first X-Forwarded-Proto and X-Forwarded-Host values for path-only request targets.
   * Defaults to false. Enable only behind a proxy that always sets or strips these headers.
   */
  readonly trustProxy?: boolean
} & (undefined extends E
  ? {
    /** Forwarded as the application's environment on every request. */
    readonly env?: E
  }
  : {
    /** Forwarded as the application's environment on every request. */
    readonly env: E
  })

/** Options after the application: required, with `env`, when the application needs an environment. */
export type NodeListenerArgs<E> = undefined extends E
  ? [options?: NodeListenerOptions<E>]
  : [options: NodeListenerOptions<E>]

/** Incoming request from Node's HTTP/1.1 or HTTP/2 compatibility API. */
export type NodeRequest = IncomingMessage | Http2ServerRequest
/** Server response from Node's HTTP/1.1 or HTTP/2 compatibility API. */
export type NodeResponse = ServerResponse | Http2ServerResponse
/** Listener suitable for a Node.js server's `request` event. */
export type NodeListener = (req: NodeRequest, res: NodeResponse) => void

// Connection-specific headers are invalid in HTTP/2 responses.
const HTTP2_CONNECTION_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade'])
// Characters that would let a Host value change the path or authority of the request URL.
const UNSAFE_HOST = /[/\\?#@\s]/

/**
 * Adapt a Fetch application to a Node.js HTTP/1.1 or HTTP/2 compatibility server.
 * Streams request and response bodies with backpressure, and aborts the Web request's
 * signal when the client disconnects before the response finishes.
 *
 * Invalid request conversion returns 400; methods forbidden by Fetch return 501.
 * Application and response failures are reported through `console.error`, returning 500
 * before headers are sent or destroying the response after they are sent.
 * Server startup and shutdown remain the caller's responsibility.
 */
export function toNodeListener<E>(app: FetchHandler<E>, ...args: NodeListenerArgs<E>): NodeListener {
  const options: { readonly env?: E; readonly trustProxy?: boolean } = args[0] ?? {}
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
  // A finished response no longer needs the rest of an unread or partly read request body.
  res.once('finish', () => {
    if (!req.complete) discardBody(req)
  })

  if (FORBIDDEN_METHODS.has((req.method ?? '').toUpperCase())) return respondEmpty(res, 501)
  let request: Request
  try {
    request = toRequest(req, trustProxy, controller.signal)
  } catch {
    return respondEmpty(res, 400)
  }

  try {
    // NodeListenerArgs requires env exactly when FetchArgs does; generic E hides that correspondence.
    const response = await app.fetch(request, ...([env, STUB_EXECUTION_CTX] as FetchArgs<E>))
    await writeResponse(response, req, res, controller.signal)
  } catch (error) {
    console.error(error)
    if (res.destroyed) return
    if (!res.headersSent) respondEmpty(res, 500)
    else res.destroy(error instanceof Error ? error : undefined)
  }
}

const discardedBodies = new WeakSet<NodeRequest>()

/**
 * Read and drop the rest of a request body, as Node does for bodies nobody reads, so the message
 * completes and an HTTP/1.1 connection stays reusable. Node only does this itself for requests
 * that were never consumed, and the Web body stream always consumes them.
 */
function discardBody(req: NodeRequest): void {
  if (discardedBodies.has(req)) return
  discardedBodies.add(req)
  req.removeAllListeners('data')
  req.resume()
}

/**
 * Expose the request body as a Web stream whose cancellation discards the remainder.
 * Canceling `Readable.toWeb` directly would destroy the request mid-message, which loses a
 * response sent after the cancel (such as a 413) or leaves a keep-alive connection stalled.
 */
function toBodyStream(req: NodeRequest): ReadableStream<Uint8Array> {
  const reader = (Readable.toWeb(req as Readable) as unknown as ReadableStream<Uint8Array>).getReader()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read()
      // Once discarded, the source ends early; closing normally would present a truncated body.
      if (discardedBodies.has(req)) controller.error(new Error('Request body discarded after the response'))
      else if (done) controller.close()
      else controller.enqueue(value)
    },
    cancel() {
      discardBody(req)
    },
  }, { highWaterMark: 0 })
}

function firstValue(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header
  return value?.split(',')[0]?.trim() || undefined
}

function toRequest(req: NodeRequest, trustProxy: boolean, signal: AbortSignal): Request {
  const http2 = req instanceof Http2ServerRequest
  let scheme = 'http'
  if (http2) {
    scheme = req.scheme
  } else if ('encrypted' in req.socket && req.socket.encrypted === true) {
    scheme = 'https'
  }
  let host = http2 ? req.authority : req.headers.host
  if (trustProxy) {
    const proto = firstValue(req.headers['x-forwarded-proto'])?.toLowerCase()
    if (proto === 'http' || proto === 'https') scheme = proto
    host = firstValue(req.headers['x-forwarded-host']) ?? host
  }

  // Request needs an absolute URL; other target forms are left to its constructor to validate.
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
    // HTTP/2 pseudo-headers belong to request metadata, not Web Headers.
    if (!name.startsWith(':')) headers.append(name, raw[i + 1]!)
  }

  const method = req.method ?? 'GET'
  const body = method === 'GET' || method === 'HEAD' ? null : toBodyStream(req)
  // `duplex` is required by Node for streaming request bodies but missing from the DOM types.
  const init: RequestInit & { duplex: 'half' } = { method, headers, body, signal, duplex: 'half' }
  return new Request(url, init)
}

function respondEmpty(res: NodeResponse, status: number): void {
  // Narrow each protocol separately: their writeHead overloads cannot be called as a union.
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
  // Set-Cookie values must stay separate because commas can occur inside individual cookies.
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
      // Body errors also abort the signal; only premature close is treated as a client disconnect.
      if (error && (error as { code?: unknown }).code !== 'ERR_STREAM_PREMATURE_CLOSE') reject(error)
      else resolve()
    })
  })
}
