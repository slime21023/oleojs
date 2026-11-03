// #region app
import { get, router, toFetch } from 'oleojs'

const routes = router(
  get('/', () => new Response('Hello, oleojs!')),
  get('/users/:id', (_request, ctx) => Response.json({ id: ctx.params.id })),
)

export default toFetch(routes)
// #endregion app

// #region test
const app = toFetch(routes)

const response = await app.fetch(new Request('http://localhost/users/42'))
console.log(await response.json()) // { id: '42' }
// #endregion test
