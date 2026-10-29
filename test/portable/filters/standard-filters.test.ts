import { describe, expect, it, vi } from 'vitest'
import { bearerAuth, cors, problemDetails, requestLogger } from '../../../src/filters/index.ts'
import type { LogEntry } from '../../../src/filters/index.ts'
import { compose, contextKey, get, group, router, toFetch } from '../../../src/index.ts'

function application() {
  const userKey = contextKey<{ id: string }>('user')
  const logs: LogEntry[] = []
  const errors: unknown[] = []
  const verify = vi.fn((token: string) => {
    if (token === 'unavailable') throw new Error('database unavailable')
    return token === 'valid' ? { id: 'alice' } : undefined
  })
  const routes = router(
    group('/users/:id', { filters: [bearerAuth({ verify, key: userKey, realm: 'api' })] },
      get('', (_req, ctx) => Response.json({ route: ctx.params.id, user: userKey.get(ctx).id })),
    ),
  )
  const app = toFetch(compose(
    requestLogger({ log: (entry) => { logs.push(entry) } }),
    cors({ origin: 'https://app.test', credentials: true }),
    problemDetails({ onError: (error) => { errors.push(error) } }),
  )(routes))
  return { app, logs, errors, verify }
}

describe('standard filter composition', () => {
  it('answers preflight before routing and authentication, and logs the final 204', async () => {
    const { app, verify, logs } = application()
    const response = await app.fetch(new Request('https://api.test/users/42', {
      method: 'OPTIONS', headers: { Origin: 'https://app.test', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Authorization' },
    }))
    expect(response.status).toBe(204)
    expect(response.body).toBeNull()
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Authorization')
    expect(verify).not.toHaveBeenCalled()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ method: 'OPTIONS', status: 204, path: '/users/42' })
  })

  it.each([
    [undefined, 'GET', 401], ['Bearer malformed,token', 'GET', 400], ['Bearer invalid', 'GET', 401],
    ['Bearer valid', 'GET', 200], ['Bearer unavailable', 'GET', 500], [undefined, 'HEAD', 401],
  ] as const)('composes authentication, error conversion, CORS, and logging: %s %s', async (authorization, method, status) => {
    const { app, logs, errors } = application()
    const headers = new Headers({ Origin: 'https://app.test' })
    if (authorization !== undefined) headers.set('Authorization', authorization)
    const response = await app.fetch(new Request('https://api.test/users/42?secret=hidden', { method, headers }))
    expect(response.status).toBe(status)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.test')
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    if (method === 'HEAD') expect(response.body).toBeNull()
    else if (status === 200) expect(await response.json()).toEqual({ route: '42', user: 'alice' })
    else {
      expect(response.headers.get('Content-Type')).toBe('application/problem+json')
      expect(await response.json()).toMatchObject({ status, type: 'about:blank' })
    }
    if (status === 400 || status === 401) expect(response.headers.get('WWW-Authenticate')).toContain('Bearer realm="api"')
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ status, method, path: '/users/42' })
    expect(logs[0]).not.toHaveProperty('error')
    expect(JSON.stringify(logs)).not.toContain('hidden')
    expect(errors).toHaveLength(status === 500 ? 1 : 0)
  })

  it('keeps routing errors outside group authentication while adding CORS and problem details', async () => {
    const { app, logs, verify } = application()
    const response = await app.fetch(new Request('https://api.test/users/42/missing', { headers: { Origin: 'https://app.test' } }))
    expect(response.status).toBe(404)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.test')
    expect(await response.json()).toMatchObject({ status: 404 })
    expect(verify).not.toHaveBeenCalled()
    expect(logs[0]?.status).toBe(404)
  })
})
