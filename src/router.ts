import { compose } from './compose.ts'
import { EMPTY_PARAMS } from './context-defaults.ts'
import { checkMethod } from './http-method.ts'
import { pathEnd, pathStart } from './path.ts'
import { MALFORMED, Trie } from './trie.ts'
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

function kindOf(value: unknown): 'route' | 'group' | undefined {
  return typeof value === 'object' && value !== null ? (value as { [KIND]?: 'route' | 'group' })[KIND] : undefined
}

// `NoInfer` keeps `TBase` from being inferred backwards from the handler, where it would
// degrade to `Params`; it comes only from the enclosing group or router.
// Contract: test/types/inference.test-d.ts, "accepts separately declared handlers typed with their full params".
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

export function router<E = unknown>(...items: Item<E, {}>[]): HttpHandler<E> {
  const trie = new Trie<HttpHandler<E, any>>()

  // Collect filters outermost first, then compose once per route during construction.
  const add = (item: unknown, prefix: string, inheritedFilters: readonly HttpFilter<E>[]): void => {
    const kind = kindOf(item)
    if (kind === 'route') {
      const { method, pattern, handler } = item as Route<E, any>
      checkMethod(method, prefix + pattern)
      trie.insert(method, prefix + pattern, compose(...inheritedFilters)(handler))
    } else if (kind === 'group') {
      const { prefix: groupPrefix, filters, items: children } = item as RouteGroup<E, any>
      const combinedFilters = [...inheritedFilters, ...filters]
      for (const child of children) add(child, prefix + groupPrefix, combinedFilters)
    } else {
      throw new TypeError(`router() expects routes and groups${prefix ? ` (in group "${prefix}")` : ''}, got ${String(item)}`)
    }
  }
  for (const item of items) add(item, '', [])

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
