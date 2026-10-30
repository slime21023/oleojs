import { checkMethod } from '../http-method.ts'
import type { HttpFilter } from '../types.ts'
import { runRouteChecks } from './route.ts'
import type { Route, RouteItem } from './route.ts'
import { Trie } from './trie.ts'
import { walkRoutes } from './walk.ts'

/** A route as `router()` registers it, after group prefixes and filters are applied. */
export interface RouteEntry<E = unknown> {
  /** The route value that was passed in; extensions can key their own metadata by it. */
  readonly route: Route<E, any>
  readonly method: string
  /** The full pattern, with enclosing group prefixes, as written. */
  readonly pattern: string
  /** Canonical segments: encoded static text, `:name` parameters, and a final `*`. */
  readonly segments: readonly string[]
  /** Enclosing group filters, outermost first. */
  readonly filters: readonly HttpFilter<E>[]
}

/**
 * List routes and groups as `router()` would register them, for documentation, client
 * generation, or other tooling. Applies the same definition checks, including those added with
 * `withRouteCheck()`, and throws the same errors in the same order. Handlers and filters are
 * never invoked. Entries follow definition order and are frozen.
 *
 * @throws {TypeError} If items, methods, or full patterns are invalid, routes conflict, or a check fails.
 */
export function inspectRoutes<E = unknown>(...items: RouteItem<E, {}>[]): readonly RouteEntry<E>[] {
  const trie = new Trie<true>()
  const entries: RouteEntry<E>[] = []
  for (const { route, pattern, filters } of walkRoutes<E>(items)) {
    checkMethod(route.method, pattern)
    const segments = trie.insert(route.method, pattern, true)
    const entry: RouteEntry<E> = Object.freeze({
      route,
      method: route.method,
      pattern,
      segments: Object.freeze([...segments]),
      filters: Object.freeze([...filters]),
    })
    runRouteChecks(entry)
    entries.push(entry)
  }
  return Object.freeze(entries)
}
