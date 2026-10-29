import type { HttpFilter } from '../types.ts'

/** Cross-origin sharing policy; origins are explicit and credentials are disabled by default. */
export interface CorsOptions {
  /** `*`, serialized origins, or a synchronous predicate that explicitly returns true to allow. */
  origin: '*' | string | readonly string[] | ((origin: string, req: Request) => boolean)
  /** Defaults to GET, HEAD, PUT, PATCH, POST, DELETE. */
  methods?: readonly string[]
  /** Defaults to reflecting Access-Control-Request-Headers on preflight responses. */
  allowHeaders?: readonly string[]
  /** Response header names made available to browser clients. Defaults to none. */
  exposeHeaders?: readonly string[]
  /** Allow credentials for an explicit origin. Cannot be combined with `origin: '*'`. */
  credentials?: boolean
  /** Preflight cache duration in whole seconds; omitted by default. */
  maxAge?: number
}

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const DEFAULT_METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE']

/**
 * Apply a CORS policy around the whole router so preflights can bypass routing and authentication.
 * Allowed preflights return 204. Other allowed responses receive copied headers and retain their body.
 * Missing or disallowed origins pass through unchanged; network-error responses also pass through.
 * Predicate and downstream errors propagate to the caller.
 *
 * @throws {TypeError} If options are invalid, when the filter is created.
 */
export function cors<E = unknown>(options: CorsOptions): HttpFilter<E> {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('cors() expects an options object with an explicit origin')
  }
  const { origin, credentials = false, maxAge } = options
  const allowsOrigin = originPolicy(origin)
  if (typeof credentials !== 'boolean' || (credentials && origin === '*')) {
    throw new TypeError('cors() credentials must be a boolean and require an explicit origin')
  }
  if (maxAge !== undefined && (!Number.isSafeInteger(maxAge) || maxAge < 0)) {
    throw new TypeError('cors() maxAge must be a non-negative safe integer')
  }
  const methods = tokenList(options.methods === undefined ? DEFAULT_METHODS : options.methods, 'methods')
  const allowHeaders = options.allowHeaders === undefined ? undefined : tokenList(options.allowHeaders, 'allowHeaders')
  const exposeHeaders = options.exposeHeaders === undefined ? '' : tokenList(options.exposeHeaders, 'exposeHeaders')

  return (next) => async (req, ctx) => {
    const requestOrigin = req.headers.get('Origin')
    if (requestOrigin === null || allowsOrigin(requestOrigin, req) !== true) return next(req, ctx)
    const preflight = req.method === 'OPTIONS' && req.headers.has('Access-Control-Request-Method')
    const response = preflight ? undefined : await next(req, ctx)
    // Response.error() and opaque responses cannot be rebuilt with the Response constructor.
    if (response?.status === 0) return response
    const headers = new Headers(response?.headers)
    headers.set('Access-Control-Allow-Origin', origin === '*' ? '*' : requestOrigin)
    if (credentials) headers.set('Access-Control-Allow-Credentials', 'true')
    else headers.delete('Access-Control-Allow-Credentials')
    appendVary(headers, 'Origin')

    if (response === undefined) {
      headers.set('Access-Control-Allow-Methods', methods)
      const allowed = allowHeaders ?? req.headers.get('Access-Control-Request-Headers') ?? ''
      if (allowed !== '') headers.set('Access-Control-Allow-Headers', allowed)
      if (allowHeaders === undefined) appendVary(headers, 'Access-Control-Request-Headers')
      if (maxAge !== undefined) headers.set('Access-Control-Max-Age', String(maxAge))
      return new Response(null, { status: 204, headers })
    }

    if (exposeHeaders !== '') headers.set('Access-Control-Expose-Headers', exposeHeaders)
    else headers.delete('Access-Control-Expose-Headers')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  }
}

function originPolicy(origin: CorsOptions['origin']): (origin: string, req: Request) => boolean {
  if (origin === '*') return () => true
  if (typeof origin === 'function') return origin
  const origins = typeof origin === 'string' ? [origin] : origin
  if (!Array.isArray(origins)) throw new TypeError('cors() expects an origin, an origin list, or a predicate')
  const allowed = new Set<string>()
  for (const value of origins) {
    if (typeof value !== 'string' || new URL(value).origin !== value) {
      throw new TypeError('cors() origins must be serialized origins without paths or trailing slashes')
    }
    allowed.add(value)
  }
  return (value) => allowed.has(value)
}

function tokenList(values: readonly string[], option: string): string {
  if (!Array.isArray(values)) throw new TypeError(`cors() ${option} must be an array of HTTP tokens`)
  for (const value of values) {
    if (typeof value !== 'string' || !TOKEN.test(value)) {
      throw new TypeError(`cors() ${option} must contain only HTTP tokens`)
    }
  }
  return values.join(', ')
}

function appendVary(headers: Headers, name: string): void {
  const existing = (headers.get('Vary') ?? '').split(',').map((value) => value.trim().toLowerCase())
  if (!existing.includes('*') && !existing.includes(name.toLowerCase())) headers.append('Vary', name)
}
