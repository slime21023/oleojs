import { compose, contextKey, get, group, router, toFetch, withFilters } from 'oleojs'
import type { HttpFilter } from 'oleojs'

// #region filter
// A filter receives the next handler and returns a new handler.
const timing: HttpFilter = (next) => async (request, ctx) => {
  const started = performance.now()
  const response = await next(request, ctx)
  console.log(`${request.method} ${request.url} took ${performance.now() - started} ms`)
  return response
}

const requireApiKey: HttpFilter = (next) => (request, ctx) =>
  request.headers.get('x-api-key') === 'secret'
    ? next(request, ctx)
    : new Response('Unauthorized', { status: 401 })
// #endregion filter

// #region apply
const routes = router(
  get('/', () => new Response('public')),
  // Group filters run only for the routes inside the group.
  group('/admin', { filters: [requireApiKey] },
    get('/stats', () => Response.json({ users: 42 })),
  ),
)

// The first filter is the outermost.
export default toFetch(withFilters(routes, timing))

// compose() builds a reusable stack from the same filters.
export const protectedStack = compose(timing, requireApiKey)
// #endregion apply

// #region context-key
const requestId = contextKey<string>('request-id')

const assignRequestId: HttpFilter = (next) => (request, ctx) =>
  next(request, requestId.with(ctx, crypto.randomUUID()))

export const withIds = toFetch(withFilters(
  router(get('/', (_request, ctx) => Response.json({ requestId: requestId.get(ctx) }))),
  assignRequestId,
))
// #endregion context-key

// #region env
interface Env {
  greeting: string
}

const greeter = toFetch(router<Env>(
  get('/', (_request, ctx) => new Response(ctx.env.greeting)),
))

// The environment is the second argument of fetch.
await greeter.fetch(new Request('http://localhost/'), { greeting: 'Hello' })
// #endregion env
