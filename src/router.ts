import { pathEnd, pathStart } from './path.ts'
import { EMPTY_PARAMS, MALFORMED, Trie } from './trie.ts'
import type { HttpHandler, ParamsOf } from './types.ts'

export interface Route<E = unknown> {
  readonly method: string
  readonly pattern: string
  // Params are checked against the pattern by the route helpers, then erased here.
  readonly handler: HttpHandler<E, any>
}

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
// Fetch upper-cases these methods, so any other casing can never match.
const NORMALIZED_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT'])
// Fetch refuses to construct requests with these methods (in any casing).
export const FORBIDDEN_METHODS: ReadonlySet<string> = new Set(['CONNECT', 'TRACE', 'TRACK'])

function checkMethod(method: string, pattern: string): void {
  const reason =
    !TOKEN.test(method) ? 'is not a valid HTTP method'
    : FORBIDDEN_METHODS.has(method.toUpperCase()) ? 'is forbidden by Fetch and can never match'
    : NORMALIZED_METHODS.has(method.toUpperCase()) && method !== method.toUpperCase()
      ? `can never match; Fetch normalizes it to "${method.toUpperCase()}"`
    : undefined
  if (reason !== undefined) throw new TypeError(`Invalid route method "${method}" for "${pattern}": ${reason}`)
}

export function route<E = unknown, TPattern extends string = string>(
  method: string,
  pattern: TPattern,
  handler: HttpHandler<E, ParamsOf<TPattern>>,
): Route<E> {
  return Object.freeze({ method, pattern, handler })
}

function methodHelper(method: string) {
  return <E = unknown, TPattern extends string = string>(
    pattern: TPattern,
    handler: HttpHandler<E, ParamsOf<TPattern>>,
  ): Route<E> => route(method, pattern, handler)
}

export const get = methodHelper('GET')
export const post = methodHelper('POST')
export const put = methodHelper('PUT')
export const patch = methodHelper('PATCH')
// `delete` is a reserved word.
export const del = methodHelper('DELETE')
export const head = methodHelper('HEAD')
export const options = methodHelper('OPTIONS')

function withoutBody(res: Response): Response {
  if (res.body === null) return res
  void res.body.cancel()
  return new Response(null, { status: res.status, statusText: res.statusText, headers: res.headers })
}

export function router<E = unknown>(...routes: Route<E>[]): HttpHandler<E> {
  const trie = new Trie<HttpHandler<E, any>>()
  for (const { method, pattern, handler } of routes) {
    checkMethod(method, pattern)
    trie.insert(method, pattern, handler)
  }

  return (req, ctx) => {
    const { url, method } = req
    const start = pathStart(url)
    const end = pathEnd(url, start)
    const handler = trie.match(method, url, start, end)

    if (handler === undefined) {
      const allow = trie.allow(url, start, end)
      if (allow.length === 0) return new Response(null, { status: 404 })
      return new Response(null, { status: 405, headers: { Allow: allow.join(', ') } })
    }
    if (handler === MALFORMED) return new Response(null, { status: 400 })

    const params = trie.params
    const res = handler(req, params === EMPTY_PARAMS ? ctx : { ...ctx, params })
    if (method !== 'HEAD') return res
    return 'then' in res ? res.then(withoutBody) : withoutBody(res)
  }
}
