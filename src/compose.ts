import type { HttpFilter } from './types.ts'

/**
 * Compose filters with the first outermost: `compose(a, b)(handler)` is `a(b(handler))`.
 * Each filter is applied when wrapping the handler; the returned handler runs per request.
 * With no filters, the returned filter leaves its handler unchanged.
 */
export function compose<E = unknown>(...filters: HttpFilter<E>[]): HttpFilter<E> {
  return (next) => filters.reduceRight((handler, filter) => filter(handler), next)
}
