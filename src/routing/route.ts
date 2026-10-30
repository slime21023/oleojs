import type { HttpFilter, HttpHandler, JoinParams, Params, ParamsOf } from '../types.ts'

// Makes missing group parameters a type error; this marker never exists at runtime.
declare const BASE: unique symbol

// Distinguish route/group values from options without relying on their public fields.
const KIND = Symbol('oleo.kind')

// Optional definition checks let extensions inspect full paths without core imports of extensions.
const validations = new WeakMap<object, (segments: readonly string[]) => void>()

export function setRouteValidation(route: object, validate: (segments: readonly string[]) => void): void {
  validations.set(route, validate)
}

export function validateRoute(route: object, segments: readonly string[]): void {
  validations.get(route)?.(segments)
}

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
  // A RouteGroup also has filters; without this marker one could pass as options in the type system
  // while group() treats it as an item, skipping the check of the parameters it requires.
  readonly [BASE]?: never
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

type GroupItem<E, TPrefix extends string, TBase extends Params> =
  RouteItem<E, JoinParams<NoInfer<TBase>, ParamsOf<TPrefix>>>

/**
 * Arguments after a group prefix: nested items, optionally preceded by shared options.
 * A single signature whose first element also accepts an item reports a mismatched item against
 * the item type; separate overloads would only report the last one's options parameter.
 */
export type GroupArgs<E, TPrefix extends string, TBase extends Params> = readonly [
  first?: GroupOptions<E> | GroupItem<E, TPrefix, TBase>,
  ...items: GroupItem<E, TPrefix, TBase>[],
]

/**
 * Group routes under a prefix, optionally with shared filters, carrying its parameters into
 * nested handlers. Filters wrap each matched route, outer groups first; unmatched requests skip them.
 * Prefixes are concatenated and full patterns validated when `router()` is called.
 * An empty child pattern matches the prefix itself; `'/'` adds a trailing slash.
 */
export function group<E = unknown, TPrefix extends string = string, TBase extends Params = {}>(
  prefix: TPrefix,
  ...rest: GroupArgs<E, TPrefix, TBase>
): RouteGroup<E, TBase>
export function group(prefix: string, ...rest: readonly unknown[]): RouteGroup {
  const hasOptions = rest.length > 0 && getRouteKind(rest[0]) === undefined
  // The optional first element also admits an explicit undefined, meaning no options.
  const options = (hasOptions ? rest[0] : undefined) as GroupOptions | undefined
  const items = (hasOptions ? rest.slice(1) : rest) as RouteItem<unknown, any>[]
  return Object.freeze({
    [KIND]: 'group' as const,
    prefix,
    filters: Object.freeze([...(options?.filters ?? [])]),
    items: Object.freeze(items),
  })
}

/** A method route helper whose environment is fixed and whose enclosing parameters default to `TBase`. */
export type BoundMethodHelper<E, TBase extends Params> = <TPattern extends string = string, TB extends Params = TBase>(
  pattern: TPattern,
  handler: HttpHandler<E, JoinParams<NoInfer<TB>, ParamsOf<TPattern>>>,
) => Route<E, TB>

/**
 * Route helpers bound to environment `E`. Routes inside a group still infer enclosing parameters;
 * a route declared on its own requires `TBase`, the parameters of the groups it will be placed in.
 *
 * `group` fixes its enclosing parameters to `TBase`, so a group declared on its own still types
 * its inline routes with the prefix parameters. A group nested inline inside a parameterized
 * group should use the core `group()`, which infers the enclosing parameters instead.
 */
export interface RouteHelpers<E, TBase extends Params = {}> {
  readonly route: <TPattern extends string = string, TB extends Params = TBase>(
    method: string,
    pattern: TPattern,
    handler: HttpHandler<E, JoinParams<NoInfer<TB>, ParamsOf<TPattern>>>,
  ) => Route<E, TB>
  readonly get: BoundMethodHelper<E, TBase>
  readonly post: BoundMethodHelper<E, TBase>
  readonly put: BoundMethodHelper<E, TBase>
  readonly patch: BoundMethodHelper<E, TBase>
  readonly del: BoundMethodHelper<E, TBase>
  readonly head: BoundMethodHelper<E, TBase>
  readonly options: BoundMethodHelper<E, TBase>
  // An inferred base would leave nothing to infer it from outside a group, which also loses the
  // prefix parameters of inline routes; a fixed base keeps standalone groups fully typed.
  readonly group: <TPrefix extends string = string>(
    prefix: TPrefix,
    ...rest: GroupArgs<E, TPrefix, TBase>
  ) => RouteGroup<E, TBase>
}

const HELPERS = Object.freeze({ route, get, post, put, patch, del, head, options, group })

/**
 * Bind the route helpers to environment `E` for routes declared apart from their router,
 * such as in another module, so their handlers need no `Route<E>` annotation.
 * `TBase` names the parameters supplied by the groups the routes will be placed in.
 * Only types are bound: the helpers are the module's own functions, shared by every call.
 */
export function routesFor<E = unknown, TBase extends Params = {}>(): RouteHelpers<E, TBase> {
  return HELPERS
}
