import { compose } from './compose.ts'
import { pathEnd, pathStart } from './path.ts'
import { EMPTY_PARAMS, MALFORMED, Trie } from './trie.ts'
import type { HttpFilter, HttpHandler, JoinParams, Params, ParamsOf } from './types.ts'

// Type-level only: never set at run time.
declare const BASE: unique symbol

// Tags the values built by the route helpers and `group()`, so `group()` can tell an
// options object from an item and `router()` can reject anything else.
const KIND = Symbol('oleo.kind')

// `TBase` is the set of prefix params this route expects from enclosing groups. The phantom
// `BASE` member carries it contravariantly: a route expecting nothing fits anywhere.
export interface Route<E = unknown, TBase extends Params = {}> {
  readonly method: string
  readonly pattern: string
  // Params are checked against the pattern by the route helpers, then erased here.
  readonly handler: HttpHandler<E, any>
  readonly [BASE]?: (base: TBase) => void
}

export interface RouteGroup<E = unknown, TBase extends Params = {}> {
  readonly prefix: string
  readonly filters: readonly HttpFilter<E>[]
  readonly items: readonly (Route<E, any> | RouteGroup<E, any>)[]
  readonly [BASE]?: (base: TBase) => void
}

export interface GroupOptions<E = unknown> {
  readonly filters?: readonly HttpFilter<E>[]
}

type Item<E, TBase extends Params> = Route<E, TBase> | RouteGroup<E, TBase>

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

function kindOf(value: unknown): 'route' | 'group' | undefined {
  return typeof value === 'object' && value !== null ? (value as { [KIND]?: 'route' | 'group' })[KIND] : undefined
}

// `NoInfer` keeps `TBase` from being inferred backwards from the handler, where it would
// degrade to `Params`; it comes only from the enclosing group or router.
export function route<E = unknown, TPattern extends string = string, TBase extends Params = {}>(
  method: string,
  pattern: TPattern,
  handler: HttpHandler<E, JoinParams<NoInfer<TBase>, ParamsOf<TPattern>>>,
): Route<E, TBase> {
  return Object.freeze({ [KIND]: 'route' as const, method, pattern, handler })
}

function methodHelper(method: string) {
  return <E = unknown, TPattern extends string = string, TBase extends Params = {}>(
    pattern: TPattern,
    handler: HttpHandler<E, JoinParams<NoInfer<TBase>, ParamsOf<TPattern>>>,
  ): Route<E, TBase> => route(method, pattern, handler)
}

export const get = methodHelper('GET')
export const post = methodHelper('POST')
export const put = methodHelper('PUT')
export const patch = methodHelper('PATCH')
// `delete` is a reserved word.
export const del = methodHelper('DELETE')
export const head = methodHelper('HEAD')
export const options = methodHelper('OPTIONS')

// Builds a value only; prefixes are joined and checked when `router()` is called.
export function group<E = unknown, TPrefix extends string = string, TBase extends Params = {}>(
  prefix: TPrefix,
  ...items: Item<E, JoinParams<NoInfer<TBase>, ParamsOf<TPrefix>>>[]
): RouteGroup<E, TBase>
export function group<E = unknown, TPrefix extends string = string, TBase extends Params = {}>(
  prefix: TPrefix,
  options: GroupOptions<E>,
  ...items: Item<E, JoinParams<NoInfer<TBase>, ParamsOf<TPrefix>>>[]
): RouteGroup<E, TBase>
export function group(prefix: string, ...rest: unknown[]): RouteGroup {
  const hasOptions = rest.length > 0 && kindOf(rest[0]) === undefined
  const options = (hasOptions ? rest[0] : {}) as GroupOptions
  const items = (hasOptions ? rest.slice(1) : rest) as Item<unknown, any>[]
  return Object.freeze({
    [KIND]: 'group' as const,
    prefix,
    filters: Object.freeze([...(options.filters ?? [])]),
    items: Object.freeze(items),
  })
}

function withoutBody(res: Response): Response | Promise<Response> {
  if (res.body === null) return res
  return res.body.cancel().then(() =>
    new Response(null, { status: res.status, statusText: res.statusText, headers: res.headers }),
  )
}

type Wrap<E> = (handler: HttpHandler<E, any>) => HttpHandler<E, any>

export function router<E = unknown>(...items: Item<E, {}>[]): HttpHandler<E> {
  const trie = new Trie<HttpHandler<E, any>>()

  // Joins prefixes outermost first; outer group filters wrap inner ones.
  const add = (item: unknown, prefix: string, wrap: Wrap<E>): void => {
    const kind = kindOf(item)
    if (kind === 'route') {
      const { method, pattern, handler } = item as Route<E, any>
      checkMethod(method, prefix + pattern)
      trie.insert(method, prefix + pattern, wrap(handler))
    } else if (kind === 'group') {
      const { prefix: own, filters, items } = item as RouteGroup<E, any>
      const filter = compose(...filters)
      const inner: Wrap<E> = filters.length === 0 ? wrap : (handler) => wrap(filter(handler))
      for (const child of items) add(child, prefix + own, inner)
    } else {
      throw new TypeError(`router() expects routes and groups${prefix ? ` (in group "${prefix}")` : ''}, got ${String(item)}`)
    }
  }
  for (const item of items) add(item, '', (handler) => handler)

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
