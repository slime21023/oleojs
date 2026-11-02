import { toFetch } from '../../src/index.ts'
import { createRoutes } from './oleojs-routes.ts'

const app = toFetch(createRoutes(Response))

// The runtime serves a default export with `fetch` (Bun's documented oleojs entry); the runner picks the port.
export default { port: Number(process.env.PORT), hostname: '127.0.0.1', fetch: app.fetch }
