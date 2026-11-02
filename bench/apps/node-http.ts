import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { announce } from '../scenarios.ts'

// Baseline without a framework: hand-written dispatch for exactly the benchmarked paths.
const resourcePrefix = '/api/resource'

function send(response: ServerResponse, contentType: string, body: string): void {
  response.writeHead(200, { 'content-type': contentType, 'content-length': Buffer.byteLength(body) })
  response.end(body)
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = request.url ?? '/'
  if (request.method === 'GET' && url === '/') return send(response, 'text/plain;charset=UTF-8', 'Hello, World!')
  if (request.method === 'GET' && url === '/middleware') return send(response, 'text/plain;charset=UTF-8', 'ok')
  if (request.method === 'POST' && url === '/echo') {
    return send(response, 'application/json', JSON.stringify(JSON.parse(await readBody(request))))
  }
  if (request.method === 'GET') {
    const segments = url.split('/')
    if (segments.length === 5 && segments[1] === 'users' && segments[3] === 'posts') {
      return send(response, 'application/json', JSON.stringify({ userId: segments[2], postId: segments[4] }))
    }
    if (url.startsWith(resourcePrefix) && segments.length === 4) {
      return send(response, 'application/json', JSON.stringify({ id: segments[3] }))
    }
  }
  response.writeHead(404).end()
}

const server = createServer((request, response) => {
  handle(request, response).catch(() => response.writeHead(500).end())
})
server.listen(0, '127.0.0.1', () => announce((server.address() as AddressInfo).port))
