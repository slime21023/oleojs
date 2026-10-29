import type { HttpFilter, HttpHandler, Params } from './types.ts'

// Infer all contravariant env requirements together; distributing would lose them beside unknown.
type FilterEnvironment<TFilter> = [TFilter] extends [HttpFilter<infer E>] ? E : unknown

/**
 * Compose filters with the first outermost: `compose(a, b)(handler)` is `a(b(handler))`.
 * Each filter is applied when wrapping the handler; the returned handler runs per request.
 * With no filters, the returned filter leaves its handler unchanged.
 * Independent environment requirements are combined into an intersection.
 */
export function compose<E = unknown>(...filters: HttpFilter<E>[]): HttpFilter<E>
export function compose<const TFilters extends readonly HttpFilter<never>[]>(...filters: TFilters): HttpFilter<FilterEnvironment<TFilters[number]>>
export function compose(...filters: HttpFilter<never>[]): HttpFilter<never> {
  return (next) => filters.reduceRight((handler, filter) => filter(handler), next)
}

/**
 * Wrap a handler in one call, with filters listed outermost first.
 * The result requires the handler's environment and every filter's requirements.
 * Route parameters are preserved; with no filters, the handler is returned unchanged.
 */
export function withFilters<E, P extends Params>(handler: HttpHandler<E, P>, ...filters: HttpFilter<E>[]): HttpHandler<E, P>
export function withFilters<E, P extends Params, const TFilters extends readonly HttpFilter<never>[]>(
  handler: HttpHandler<E & FilterEnvironment<TFilters[number]>, P>,
  ...filters: TFilters
): HttpHandler<E & FilterEnvironment<TFilters[number]>, P>
export function withFilters<E, P extends Params>(handler: HttpHandler<E, P>, ...filters: HttpFilter<E>[]): HttpHandler<E, P> {
  return compose<E>(...filters)(handler)
}
