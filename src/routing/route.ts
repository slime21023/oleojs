import type { HttpFilter, HttpHandler, JoinParams, Params, ParamsOf } from '../types.ts'

// Makes missing group parameters a type error; this marker never exists at runtime.
declare const BASE: unique symbol

// Distinguish route/group values from options without relying on their public fields.
const KIND = Symbol('oleo.kind')

/**
 * An immutable route definition created by the route helpers and validated by `router()`.
 * `TBase` describes parameters that enclosing groups must supply.
 */
export interface Route<E = unknown, TBase extends Params = {}> {
  readonly method: string
  readonly pattern: string
  // Params are checked against the pattern by the route helpers, then erased here.
  readonly handler: HttpHandler<E, any>
  readonly [BASE]?: (base: TBase) => void
}

/**
 * Routes sharing a prefix and filters, with `TBase` supplied by enclosing groups.
 * Annotate separately declared groups as `RouteGroup<Env>` to infer prefix parameters in handlers.
 */
export interface RouteGroup<E = unknown, TBase extends Params = {}> {
  readonly prefix: string
  /** Filters in outermost-first order, applied after routing supplies the full parameters. */
  readonly filters: readonly HttpFilter<E>[]
  readonly items: readonly (Route<E, any> | RouteGroup<E, any>)[]
  readonly [BASE]?: (base: TBase) => void
}

/** Middleware shared by the matched routes of a group, including nested groups. */
export interface GroupOptions<E = unknown> {
  /**
   * Wrap each route with the first filter outermost. Wrappers are built once per route
   * during router construction; unmatched requests skip these filters.
   */
  readonly filters?: readonly HttpFilter<E>[]
}

export type RouteItem<E, TBase extends Params> = Route<E, TBase> | RouteGroup<E, TBase>

export function getRouteKind(value: unknown): 'route' | 'group' | undefined {
  return typeof value === 'object' && value !== null ? (value as { [KIND]?: 'route' | 'group' })[KIND] : undefined
}

/**
 * Create an immutable route for an HTTP method, with parameters inferred from its pattern.
 * Patterns support static segments, `:name` parameters, and a terminal `*` wildcard.
 * Inside a group, `''` addresses the group prefix itself. Method and pattern validation
 * happens when the route is passed to `router()`.
 */
export function route<E = unknown, TPattern extends string = string, TBase extends Params = {}>(
  method: string,
  pattern: TPattern,
  // NoInfer keeps a separately typed handler from widening the enclosing group's parameters.
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

/** Create a GET route with inferred path parameters. */
export const get = methodHelper('GET')
/** Create a POST route with inferred path parameters. */
export const post = methodHelper('POST')
/** Create a PUT route with inferred path parameters. */
export const put = methodHelper('PUT')
/** Create a PATCH route with inferred path parameters. */
export const patch = methodHelper('PATCH')
/** Create a DELETE route; named `del` because `delete` is a reserved word. */
export const del = methodHelper('DELETE')
/** Create an explicit HEAD route; the router removes any response body. */
export const head = methodHelper('HEAD')
/** Create an explicit OPTIONS route. */
export const options = methodHelper('OPTIONS')

/**
 * Group routes under a prefix, carrying its parameters into nested handlers.
 * Prefixes are concatenated and full patterns validated when `router()` is called.
 * An empty child pattern matches the prefix itself; `'/'` adds a trailing slash.
 */
export function group<E = unknown, TPrefix extends string = string, TBase extends Params = {}>(
  prefix: TPrefix,
  ...items: RouteItem<E, JoinParams<NoInfer<TBase>, ParamsOf<TPrefix>>>[]
): RouteGroup<E, TBase>
/**
 * Group routes under a prefix with shared filters, carrying its parameters into nested handlers.
 * Filters wrap each matched route, outer groups first; unmatched requests skip them.
 * Prefixes and full patterns are validated when `router()` is called.
 */
export function group<E = unknown, TPrefix extends string = string, TBase extends Params = {}>(
  prefix: TPrefix,
  options: GroupOptions<E>,
  ...items: RouteItem<E, JoinParams<NoInfer<TBase>, ParamsOf<TPrefix>>>[]
): RouteGroup<E, TBase>
export function group(prefix: string, ...rest: unknown[]): RouteGroup {
  const hasOptions = rest.length > 0 && getRouteKind(rest[0]) === undefined
  const options = (hasOptions ? rest[0] : {}) as GroupOptions
  const items = (hasOptions ? rest.slice(1) : rest) as RouteItem<unknown, any>[]
  return Object.freeze({
    [KIND]: 'group' as const,
    prefix,
    filters: Object.freeze([...(options.filters ?? [])]),
    items: Object.freeze(items),
  })
}
