import type { IncomingMessage, ServerResponse } from 'node:http'
import { Http2ServerRequest, Http2ServerResponse } from 'node:http2'
import { Readable } from 'node:stream'
import { STUB_EXECUTION_CTX } from '../context-defaults.ts'
import { FORBIDDEN_METHODS } from '../http-method.ts'
import type { FetchArgs, FetchHandler } from '../types.ts'
import { lazyRequest, normalizeMethod, normalizeUrl, toHeaders } from './request.ts'
import { type FastResponseParts, fastResponseParts } from './response.ts'

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
  /**
   * Pass the application a lightweight Request: `method`, `url`, `headers`, `signal`, and the
   * `text()`, `json()`, `arrayBuffer()`, and `bytes()` body reads work without building the native
   * Request, which any other member builds on first use. Defaults to true.
   * It passes `instanceof Request`, but `new Request(request, init)`, `fetch(request)`, and
   * native methods called with it as `this` throw a TypeError. Set false to pass native Requests.
   */
  readonly lazyRequest?: boolean
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
  const options: { readonly env?: E; readonly trustProxy?: boolean; readonly lazyRequest?: boolean } = args[0] ?? {}
  const { env, trustProxy = false, lazyRequest = true } = options
  const ingress: Ingress = { trustProxy, lazyRequest }
  return (req, res) => {
    void handle(app, env, ingress, req, res)
  }
}

/** How Node requests become Web requests. */
interface Ingress {
  readonly trustProxy: boolean
  readonly lazyRequest: boolean
}

async function handle<E>(
  app: FetchHandler<E>,
  env: E | undefined,
  ingress: Ingress,
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
    request = toRequest(req, ingress, controller.signal)
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

/** Read the whole request body without a Web stream, for the lazy request's body methods. */
async function readBody(req: NodeRequest): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk)
  // Once discarded, the source ends early; resolving would present a truncated body.
  if (discardedBodies.has(req)) throw new Error('Request body discarded after the response')
  return Buffer.concat(chunks)
}

function firstValue(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header
  return value?.split(',')[0]?.trim() || undefined
}

function toRequest(req: NodeRequest, ingress: Ingress, signal: AbortSignal): Request {
  const http2 = req instanceof Http2ServerRequest
  let scheme = 'http'
  if (http2) {
    scheme = req.scheme
  } else if ('encrypted' in req.socket && req.socket.encrypted === true) {
    scheme = 'https'
  }
  let host = http2 ? req.authority : req.headers.host
  if (ingress.trustProxy) {
    const proto = firstValue(req.headers['x-forwarded-proto'])?.toLowerCase()
    if (proto === 'http' || proto === 'https') scheme = proto
    host = firstValue(req.headers['x-forwarded-host']) ?? host
  }

  // Request needs an absolute URL; other target forms are left to its constructor to validate.
  const target = req.url ?? ''
  const originForm = target.startsWith('/')
  if (originForm && (host === undefined || host === '' || UNSAFE_HOST.test(host))) {
    throw new TypeError(`Invalid host: ${host}`)
  }
  const method = req.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD'

  if (ingress.lazyRequest) {
    // Validate and normalize here what the Request constructor would, so failures still become 400.
    return lazyRequest({
      url: normalizeUrl(scheme, originForm ? host : undefined, target),
      method: normalizeMethod(method),
      rawHeaders: req.rawHeaders,
      signal,
      body: hasBody ? { stream: () => toBodyStream(req), read: () => readBody(req) } : null,
    })
  }

  const url = originForm ? `${scheme}://${host}${target}` : target
  const body = hasBody ? toBodyStream(req) : null
  // `duplex` is required by Node for streaming request bodies but missing from the DOM types.
  const init: RequestInit & { duplex: 'half' } = { method, headers: toHeaders(req.rawHeaders), body, signal, duplex: 'half' }
  return new Request(url, init)
}

function respondEmpty(res: NodeResponse, status: number): void {
  // Narrow each protocol separately: their writeHead overloads cannot be called as a union.
  if (res instanceof Http2ServerResponse) res.writeHead(status)
  else res.writeHead(status)
  res.end()
}

async function writeResponse(response: Response, req: NodeRequest, res: NodeResponse, signal: AbortSignal): Promise<void> {
  const fast = fastResponseParts(response)
  if (fast !== undefined) return writeFastResponse(fast, req, res, signal)

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

  writeHead(res, response.status, response.statusText, toNodeHeaders(response.headers, res))
  if (body === null || req.method === 'HEAD') {
    res.end()
    return
  }

  await writeBody(body, res, signal)
}

/** Write an unread FastResponse in one `end()` call, with Content-Length for its body. */
function writeFastResponse(parts: FastResponseParts, req: NodeRequest, res: NodeResponse, signal: AbortSignal): void {
  if (signal.aborted) return
  const headers = parts.headers === undefined ? {} : toNodeHeaders(parts.headers, res)
  if (parts.contentType !== undefined) headers['content-type'] = parts.contentType
  const { body } = parts
  if (body !== null && headers['content-length'] === undefined) {
    headers['content-length'] = String(typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength)
  }
  writeHead(res, parts.status, parts.statusText, headers)
  if (body === null || req.method === 'HEAD') res.end()
  else res.end(body)
}

function toNodeHeaders(source: Headers, res: NodeResponse): Record<string, string | string[]> {
  const http2 = res instanceof Http2ServerResponse
  const headers: Record<string, string | string[]> = {}
  for (const [name, value] of source) {
    if (name !== 'set-cookie' && !(http2 && HTTP2_CONNECTION_HEADERS.has(name))) headers[name] = value
  }
  // Set-Cookie values must stay separate because commas can occur inside individual cookies.
  const cookies = source.getSetCookie()
  if (cookies.length > 0) headers['set-cookie'] = cookies
  return headers
}

function writeHead(res: NodeResponse, status: number, statusText: string, headers: Record<string, string | string[]>): void {
  if (res instanceof Http2ServerResponse) res.writeHead(status, headers)
  else if (statusText !== '') res.writeHead(status, statusText, headers)
  else res.writeHead(status, headers)
}

/**
 * Copy a Web body to the response, waiting for `drain` when Node's buffer is full.
 * A direct reader loop avoids the per-response cost of `Readable.fromWeb` and `pipeline`.
 * A client disconnect cancels the body, which also ends a pending read; a cancellation
 * failure propagates like a body error.
 */
async function writeBody(body: ReadableStream<Uint8Array>, res: NodeResponse, signal: AbortSignal): Promise<void> {
  const reader = body.getReader()
  let cancellation: Promise<void> | undefined
  const cancel = () => {
    cancellation = reader.cancel()
    // Observed here so a failure is not also reported as unhandled before it is awaited below.
    cancellation.catch(() => {})
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done || signal.aborted) break
      // Narrow each protocol separately: their write overloads cannot be called as a union.
      const accepted = res instanceof Http2ServerResponse ? res.write(value) : res.write(value)
      if (!accepted) await drained(res)
    }
  } finally {
    signal.removeEventListener('abort', cancel)
  }
  if (!signal.aborted) res.end()
  else await (cancellation ?? reader.cancel())
}

/** Resolve once the response can accept more data or has closed. */
function drained(res: NodeResponse): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      res.off('drain', done)
      res.off('close', done)
      resolve()
    }
    res.on('drain', done)
    res.on('close', done)
  })
}
