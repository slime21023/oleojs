import type { HttpFilter } from '../types.ts'
import { getRouteKind } from './route.ts'
import type { Route, RouteGroup } from './route.ts'

interface FlatRoute<E> {
  readonly route: Route<E, any>
  readonly pattern: string
  readonly filters: readonly HttpFilter<E>[]
}

/** Expand definitions without applying filters or invoking handlers. */
export function* walkRoutes<E>(
  items: readonly unknown[], prefix = '', filters: readonly HttpFilter<E>[] = [],
): Generator<FlatRoute<E>> {
  for (const item of items) {
    const kind = getRouteKind(item)
    if (kind === 'route') {
      const route = item as Route<E, any>
      yield { route, pattern: prefix + route.pattern, filters }
    } else if (kind === 'group') {
      const group = item as RouteGroup<E, any>
      yield* walkRoutes(group.items, prefix + group.prefix, [...filters, ...group.filters])
    } else {
      throw new TypeError(`router() expects routes and groups${prefix ? ` (in group "${prefix}")` : ''}, got ${String(item)}`)
    }
  }
}
