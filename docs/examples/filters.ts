import { contextKey, get, group, router, toFetch, withFilters } from 'oleojs'
import {
  bearerAuth, bodyLimit, cors, mapRequest, mapResponse, problemDetails, requestLogger, responseHeaders,
} from 'oleojs/filters'

interface User { id: string }
interface Env { verifyToken(token: string): Promise<User | undefined> }
const userKey = contextKey<User>('user')
const routes = router<Env>(get('/', () => new Response('ok')))

// #region stack
export const app = toFetch(withFilters(
  router<Env>(
    group('/api', {
      filters: [bearerAuth({ key: userKey, verify: (token, _request, ctx) => ctx.env.verifyToken(token) })],
    }, get('/me', (_request, ctx) => Response.json(userKey.get(ctx)))),
  ),
  requestLogger(),                             // outermost: logs the final status
  cors({ origin: 'https://app.example.com' }), // also adds headers to error responses
  problemDetails(),                            // turns errors into JSON problem documents
  bodyLimit({ maxBytes: 1024 * 1024 }),        // rejects larger bodies with 413
))
// #endregion stack

// #region cors
withFilters(routes, cors({
  origin: ['https://app.example.com', 'https://admin.example.com'],
  credentials: true,
  maxAge: 600,
}))
// #endregion cors

// #region bearer-auth
router<Env>(
  group('/api', {
    filters: [bearerAuth({
      verify: (token, _request, ctx) => ctx.env.verifyToken(token), // return undefined to reject
      key: userKey,                                                 // optional: store the user
      realm: 'api',
    })],
  }, get('/me', (_request, ctx) => Response.json(userKey.get(ctx)))),
)
// #endregion bearer-auth

// #region problem-details
class NotFoundError extends Error {}

withFilters(routes, problemDetails({
  fromError: (error) => (error instanceof NotFoundError ? { status: 404, detail: error.message } : undefined),
}))
// #endregion problem-details

// #region request-logger
withFilters(routes, requestLogger({
  log: (entry) => console.log(entry), // { method, path, status, durationMs }
  fields: (request) => ({ userAgent: request.headers.get('user-agent') }),
}))
// #endregion request-logger

// #region body-limit
withFilters(routes, problemDetails(), bodyLimit({ maxBytes: 64 * 1024 }))
// #endregion body-limit

// #region transforms
withFilters(routes,
  mapRequest((request) => {
    const headers = new Headers(request.headers)
    headers.set('accept-language', headers.get('accept-language') ?? 'en')
    return new Request(request.url, { method: request.method, headers, signal: request.signal })
  }),
  mapResponse(async (response) => (response.status === 404 ? new Response('Nothing here', { status: 404 }) : response)),
  responseHeaders({ 'Cache-Control': 'no-store' }),
)
// #endregion transforms
