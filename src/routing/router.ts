import { compose } from '../compose.ts'
import { EMPTY_PARAMS } from '../context-defaults.ts'
import { checkMethod } from '../http-method.ts'
import { pathEnd, pathStart } from '../path.ts'
import type { HttpFilter, HttpHandler } from '../types.ts'
import { getRouteKind } from './route.ts'
import type { Route, RouteGroup, RouteItem } from './route.ts'
import { MALFORMED, Trie } from './trie.ts'

function withoutBody(res: Response): Response | Promise<Response> {
  if (res.body === null) return res
  return res.body.cancel().then(() =>
    new Response(null, { status: res.status, statusText: res.statusText, headers: res.headers }),
  )
}

export function router<E = unknown>(...items: RouteItem<E, {}>[]): HttpHandler<E> {
  const trie = new Trie<HttpHandler<E, any>>()

  // Collect filters outermost first, then compose once per route during construction.
  const add = (item: unknown, prefix: string, inheritedFilters: readonly HttpFilter<E>[]): void => {
    const kind = getRouteKind(item)
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
