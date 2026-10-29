import type { HttpFilter } from './types.ts'

// `compose(a, b)(h)` is `a(b(h))`: the first filter is outermost. Filters are applied
// once, when the composed filter is applied, never per request.
export function compose<E = unknown>(...filters: HttpFilter<E>[]): HttpFilter<E> {
  return (next) => filters.reduceRight((handler, filter) => filter(handler), next)
}
