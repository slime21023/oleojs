/** One request shape that every benchmarked application serves identically. */
export interface Scenario {
  readonly name: string
  readonly description: string
  readonly method: 'GET' | 'POST'
  readonly path: string
  readonly body?: string
  /** The exact body every application must return, checked before measuring. */
  readonly expected: string
}

export const FILLER_ROUTE_COUNT = 50
export const MIDDLEWARE_COUNT = 5

const echoBody = JSON.stringify({ name: 'oleojs', tags: ['http', 'router'], version: 1 })

export const scenarios: readonly Scenario[] = [
  {
    name: 'plain-text',
    description: 'GET / returns a short text body',
    method: 'GET',
    path: '/',
    expected: 'Hello, World!',
  },
  {
    name: 'route-params',
    description: 'GET /users/:userId/posts/:postId returns both parameters as JSON',
    method: 'GET',
    path: '/users/42/posts/7',
    expected: JSON.stringify({ userId: '42', postId: '7' }),
  },
  {
    name: 'json-body',
    description: 'POST /echo parses a JSON body and returns it',
    method: 'POST',
    path: '/echo',
    body: echoBody,
    expected: echoBody,
  },
  {
    name: 'middleware',
    description: `GET /middleware passes through ${MIDDLEWARE_COUNT} no-op middleware`,
    method: 'GET',
    path: '/middleware',
    expected: 'ok',
  },
  {
    name: 'many-routes',
    description: `GET /api/resource${FILLER_ROUTE_COUNT - 1}/123 is the last of ${FILLER_ROUTE_COUNT} parameterized routes`,
    method: 'GET',
    path: `/api/resource${FILLER_ROUTE_COUNT - 1}/123`,
    expected: JSON.stringify({ id: '123' }),
  },
]

/** Reports the port to the runner once the server is listening. */
export function announce(port: number): void {
  process.stdout.write(`${JSON.stringify({ port })}\n`)
}
