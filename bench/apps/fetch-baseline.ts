// Baseline without a framework for fetch-entry runtimes: hand-written dispatch for exactly the benchmarked paths.
const resourcePrefix = '/api/resource'
const textInit = { headers: { 'content-type': 'text/plain;charset=UTF-8' } }

async function fetch(request: Request): Promise<Response> {
  // The path starts at the first '/' after the scheme's '//'.
  const url = request.url
  const path = url.slice(url.indexOf('/', url.indexOf('//') + 2))
  if (request.method === 'GET' && path === '/') return new Response('Hello, World!', textInit)
  if (request.method === 'GET' && path === '/middleware') return new Response('ok', textInit)
  if (request.method === 'POST' && path === '/echo') return Response.json(await request.json())
  if (request.method === 'GET') {
    const segments = path.split('/')
    if (segments.length === 5 && segments[1] === 'users' && segments[3] === 'posts') {
      return Response.json({ userId: segments[2], postId: segments[4] })
    }
    if (path.startsWith(resourcePrefix) && segments.length === 4) return Response.json({ id: segments[3] })
  }
  return new Response(null, { status: 404 })
}

export default { port: Number(process.env.PORT), hostname: '127.0.0.1', fetch }
