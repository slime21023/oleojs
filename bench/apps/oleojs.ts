import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { toFetch } from '../../src/index.ts'
import { FastResponse, toNodeListener } from '../../src/node/index.ts'
import { announce } from '../scenarios.ts'
import { createRoutes } from './oleojs-routes.ts'

// `--fast-response` answers with oleojs/node's FastResponse instead of the native Response.
const R = process.argv.includes('--fast-response') ? FastResponse : Response

// `--native-request` benchmarks the adapter with `lazyRequest: false`.
const lazyRequest = !process.argv.includes('--native-request')
const server = createServer(toNodeListener(toFetch(createRoutes(R)), { lazyRequest }))
server.listen(0, '127.0.0.1', () => announce((server.address() as AddressInfo).port))
