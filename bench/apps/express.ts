import type { AddressInfo } from 'node:net'
import express from 'express'
import type { RequestHandler } from 'express'
import { FILLER_ROUTE_COUNT, MIDDLEWARE_COUNT, announce } from '../scenarios.ts'

const passThrough: RequestHandler = (_request, _response, next) => next()

// Express defaults (ETag, X-Powered-By) stay on: they are what an Express application gets.
const app = express()

app.get('/', (_request, response) => {
  response.type('text/plain').send('Hello, World!')
})
app.get('/users/:userId/posts/:postId', (request, response) => {
  response.json({ userId: request.params.userId, postId: request.params.postId })
})
app.post('/echo', express.json(), (request, response) => {
  response.json(request.body)
})
app.get('/middleware', ...Array.from({ length: MIDDLEWARE_COUNT }, () => passThrough), (_request, response) => {
  response.type('text/plain').send('ok')
})
for (let index = 0; index < FILLER_ROUTE_COUNT; index++) {
  app.get(`/api/resource${index}/:id`, (request, response) => {
    response.json({ id: request.params.id })
  })
}

const server = app.listen(0, '127.0.0.1', () => announce((server.address() as AddressInfo).port))
