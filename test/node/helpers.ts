import { type IncomingHttpHeaders, type OutgoingHttpHeaders, createServer, request as httpRequest } from 'node:http'
import type { AddressInfo, Server } from 'node:net'
import { connect as netConnect } from 'node:net'
import type { FetchHandler } from '../../src/types.ts'
import { type NodeListenerArgs, toNodeListener } from '../../src/node/listener.ts'

const servers: Server[] = []

/** Close every server started through `listen`; register with `afterEach`. */
export async function closeServers(): Promise<void> {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
}

export async function listen(server: Server): Promise<number> {
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return (server.address() as AddressInfo).port
}

export function serve<E>(app: FetchHandler<E>, ...options: NodeListenerArgs<E>): Promise<number> {
  return listen(createServer(toNodeListener(app, ...options)))
}

export const fetchable = (fetch: (request: Request) => Response | Promise<Response>): FetchHandler => ({
  fetch: async (request) => fetch(request),
})

export interface Reply {
  status: number
  statusMessage: string
  headers: IncomingHttpHeaders
  body: string
}

export function send(port: number, method: string, path: string, headers: OutgoingHttpHeaders = {}, body?: string) {
  return new Promise<Reply>((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => (text += chunk))
      res.on('end', () =>
        resolve({ status: res.statusCode!, statusMessage: res.statusMessage!, headers: res.headers, body: text }),
      )
    })
    req.on('error', reject)
    req.end(body)
  })
}

// Sends raw bytes, for request targets and headers that normal clients refuse to produce.
export function sendRaw(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(port, '127.0.0.1', () => socket.end(text))
    let reply = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => (reply += chunk))
    socket.on('end', () => resolve(reply))
    socket.on('error', reject)
  })
}

export const echoUrl = fetchable((request) => new Response(request.url))
