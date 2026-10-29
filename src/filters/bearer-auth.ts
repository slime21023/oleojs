import type { ContextKey } from '../context-key.ts'
import type { Context, HttpFilter } from '../types.ts'

/** Application-owned token verification and optional storage of its principal. */
export interface BearerAuthOptions<E = unknown, T = unknown> {
  /** Return a principal matching the key's type, or undefined to reject. Exceptions propagate. */
  // The verifier must not widen the key's principal type to unknown during inference.
  verify: (token: string, req: Request, ctx: Context<E>) => NoInfer<T> | undefined | Promise<NoInfer<T> | undefined>
  /** Store the principal in a derived context using this key. */
  key?: ContextKey<T>
  /** Challenge realm; quotes, backslashes, and HTTP control characters are rejected. */
  realm?: string
}

const BEARER_SCHEME = /^Bearer(?:[ \t]|$)/i
// RFC 6750 b64token allows padding only at the end and requires one or more spaces after Bearer.
const CREDENTIALS = /^Bearer +([A-Za-z0-9._~+/-]+=*)$/i

/**
 * Authenticate a Bearer Authorization header before invoking the wrapped handler.
 * Missing credentials return 401, malformed credentials 400, and rejected tokens 401.
 * Challenges have empty bodies so `problemDetails` can render them. Only undefined rejects
 * verification; false, null, and other values are valid principals. The token is never logged.
 *
 * Group filters protect matched routes only; unmatched paths do not invoke verification.
 * @throws {TypeError} If options are invalid, when the filter is created.
 */
export function bearerAuth<E = unknown, T = unknown>(options: BearerAuthOptions<E, T>): HttpFilter<E> {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('bearerAuth() expects an options object with a verify function')
  }
  const { verify, key, realm } = options
  if (typeof verify !== 'function') throw new TypeError('bearerAuth() expects verify to be a function')
  if (realm !== undefined && (typeof realm !== 'string' || !isValidRealm(realm))) {
    throw new TypeError('bearerAuth() realm must be a valid quoted header value')
  }
  if (key !== undefined && (key === null || typeof key !== 'object' || typeof key.name !== 'string'
    || typeof key.get !== 'function' || typeof key.find !== 'function' || typeof key.with !== 'function')) {
    throw new TypeError('bearerAuth() key must be a context key')
  }
  const challenge = realm === undefined ? 'Bearer' : `Bearer realm="${realm}"`
  const separator = realm === undefined ? ' ' : ', '
  const reject = (status: 400 | 401, error?: 'invalid_request' | 'invalid_token') => new Response(null, {
    status,
    headers: { 'WWW-Authenticate': error === undefined ? challenge : `${challenge}${separator}error="${error}"` },
  })

  return (next) => async (req, ctx) => {
    const authorization = req.headers.get('Authorization')
    if (authorization === null || !BEARER_SCHEME.test(authorization)) return reject(401)
    const token = CREDENTIALS.exec(authorization)?.[1]
    if (token === undefined) return reject(400, 'invalid_request')
    const principal = await verify(token, req, ctx)
    if (principal === undefined) return reject(401, 'invalid_token')
    return next(req, key === undefined ? ctx : key.with(ctx, principal))
  }
}

function isValidRealm(realm: string): boolean {
  for (let i = 0; i < realm.length; i++) {
    const code = realm.charCodeAt(i)
    // Header values are byte strings; quotes and backslashes would need escaping.
    if (code < 0x20 || code === 0x7f || code > 0xff || realm[i] === '"' || realm[i] === '\\') return false
  }
  return true
}
