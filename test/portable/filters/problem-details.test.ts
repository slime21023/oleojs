import { afterEach, describe, expect, it, vi } from 'vitest'
import { problemDetails } from '../../../src/filters/index.ts'
import type { Problem, ProblemDetailsOptions } from '../../../src/filters/index.ts'
import { get, router, toFetch } from '../../../src/index.ts'
import type { HttpHandler } from '../../../src/types.ts'

const request = (method = 'GET') => new Request('https://example.test/', { method })
const internalProblem = { status: 500, type: 'about:blank', title: 'Internal Server Error' }

function app(handler: HttpHandler, options?: ProblemDetailsOptions) {
  return toFetch(problemDetails(options)(handler))
}

afterEach(() => vi.restoreAllMocks())

describe('problemDetails options', () => {
  it.each([null, [], true, 42, 'options', () => {}])('rejects a non-object options value: %s', (options) => {
    // JavaScript callers can bypass the declared option types.
    expect(() => problemDetails(options as unknown as ProblemDetailsOptions)).toThrow(TypeError)
  })

  it.each([
    { fromError: null }, { fromError: 42 },
    { onError: null }, { onError: false },
    { emptyResponses: null }, { emptyResponses: 'true' },
  ])('validates options before a handler is wrapped: %j', (options) => {
    expect(() => problemDetails(options as unknown as ProblemDetailsOptions)).toThrow(TypeError)
  })
})

describe('thrown errors', () => {
  it.each(['throw', 'reject'])('renders a generic 500 for a handler that can %s', async (mode) => {
    const error = new Error('private database credentials')
    const onError = vi.fn()
    const req = request()
    const response = await app(() => {
      if (mode === 'reject') return Promise.reject(error)
      throw error
    }, { onError }).fetch(req)

    expect(response.status).toBe(500)
    expect(response.headers.get('Content-Type')).toBe('application/problem+json')
    expect(await response.json()).toEqual(internalProblem)
    expect(onError).toHaveBeenCalledExactlyOnceWith(error, req)
  })

  it('uses console.error as the default reporter', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('private failure')
    await app(() => { throw error }).fetch(request())
    expect(report).toHaveBeenCalledExactlyOnceWith(error)
  })

  it('maps errors with the original request and preserves explicit fields and extensions', async () => {
    const error = new Error('invalid input')
    const req = request('POST')
    const problem = Object.freeze({
      status: 422,
      type: 'https://example.test/problems/validation',
      title: 'Invalid input',
      detail: 'Choose a positive quantity.',
      instance: '/orders/42',
      errors: [{ field: 'quantity', code: 'positive' }],
    })
    const fromError = vi.fn(() => problem)
    const onError = vi.fn()
    const response = await app(() => { throw error }, { fromError, onError }).fetch(req)

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual(problem)
    expect(fromError).toHaveBeenCalledExactlyOnceWith(error, req)
    expect(onError).not.toHaveBeenCalled()
  })

  it.each([400, 499, 500, 599])('reports mapped errors only when status %i is a server error', async (status) => {
    const error = new Error('mapped error')
    const onError = vi.fn()
    const response = await app(() => { throw error }, { fromError: () => ({ status }), onError }).fetch(request())
    expect(response.status).toBe(status)
    expect(onError).toHaveBeenCalledTimes(status >= 500 ? 1 : 0)
  })

  it('falls back when the mapper returns undefined', async () => {
    const onError = vi.fn()
    const error = new Error('unrecognized error')
    const response = await app(() => { throw error }, { fromError: () => undefined, onError }).fetch(request())
    expect(await response.json()).toEqual(internalProblem)
    expect(onError).toHaveBeenCalledOnce()
  })

  it('reports the original error when the mapper throws', async () => {
    const original = new Error('original failure')
    const onError = vi.fn()
    const req = request()
    const response = await app(() => { throw original }, {
      fromError: () => { throw new Error('mapping failure') },
      onError,
    }).fetch(req)

    expect(await response.json()).toEqual(internalProblem)
    expect(onError).toHaveBeenCalledExactlyOnceWith(original, req)
  })

  it.each([399, 600, 400.5, NaN, Infinity, '400', undefined])('rejects an invalid mapped status: %s', async (status) => {
    const error = new Error('original')
    const onError = vi.fn()
    const req = request()
    const response = await app(() => { throw error }, {
      fromError: () => ({ status }) as Problem,
      onError,
    }).fetch(req)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual(internalProblem)
    expect(onError).toHaveBeenCalledExactlyOnceWith(error, req)
  })

  it.each([
    false, [], 'problem',
    { status: 400, type: 12 },
    { status: 400, title: null },
    { status: 400, detail: false },
    { status: 400, instance: {} },
    { status: 400, value: 1n },
    { status: 400, toJSON: () => ({ status: 200 }) },
  ])('falls back for an invalid problem document: %s', async (problem) => {
    const response = await app(() => { throw new Error('original') }, {
      fromError: () => problem as Problem,
      onError: () => {},
    }).fetch(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual(internalProblem)
  })

  it.each(['GET', 'HEAD'])('handles cyclic extensions consistently for %s', async (method) => {
    const problem: Problem = { status: 400 }
    const cyclic = { problem }
    const response = await app(() => { throw new Error('original') }, {
      fromError: () => Object.assign(problem, { cyclic }),
      onError: () => {},
    }).fetch(request(method))
    expect(response.status).toBe(500)
    if (method === 'HEAD') expect(response.body).toBeNull()
    else expect(await response.json()).toEqual(internalProblem)
  })

  it.each(['throw', 'reject'])('preserves the mapped response when reporting can %s', async (mode) => {
    const reportingError = new Error('reporting failed')
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await app(() => { throw new Error('original') }, {
      fromError: () => ({ status: 503, title: 'Try later' }),
      onError: () => {
        if (mode === 'reject') return Promise.reject(reportingError)
        throw reportingError
      },
    }).fetch(request())

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: 503, type: 'about:blank', title: 'Try later' })
    expect(report).toHaveBeenCalledExactlyOnceWith(reportingError)
  })
})

describe('returned responses', () => {
  it('copies an empty error response while preserving status text and protocol headers', async () => {
    const original = new Response(null, {
      status: 405,
      statusText: 'Unsupported method',
      headers: { Allow: 'GET, HEAD', 'WWW-Authenticate': 'Bearer', 'Access-Control-Allow-Origin': '*' },
    })
    const before = [...original.headers]
    const onError = vi.fn()
    const response = await app(() => original, { onError }).fetch(request())

    expect(response).not.toBe(original)
    expect(response.status).toBe(405)
    expect(response.statusText).toBe('Unsupported method')
    for (const [name, value] of before) expect(response.headers.get(name)).toBe(value)
    expect([...original.headers]).toEqual(before)
    expect(original.body).toBeNull()
    expect(await response.json()).toEqual({ status: 405, type: 'about:blank', title: 'Method Not Allowed' })
    expect(onError).not.toHaveBeenCalled()
  })

  it.each(['GET', 'HEAD'])('replaces stale representation headers for %s', async (method) => {
    const original = new Response(null, {
      status: 404,
      headers: { 'Content-Type': 'text/plain', 'Content-Length': '0', 'Content-Encoding': 'gzip' },
    })
    const response = await app(() => original).fetch(request(method))
    expect(response.headers.get('Content-Type')).toBe('application/problem+json')
    expect(response.headers.has('Content-Length')).toBe(false)
    expect(response.headers.has('Content-Encoding')).toBe(false)
    expect(original.headers.get('Content-Length')).toBe('0')
    expect(original.headers.get('Content-Encoding')).toBe('gzip')
    expect(original.headers.get('Content-Type')).toBe('text/plain')
  })

  it.each([
    [413, 'Content Too Large'], [422, 'Unprocessable Content'], [511, 'Network Authentication Required'],
  ] as const)('uses the registered title for %i', async (status, title) => {
    const response = await app(() => new Response(null, { status })).fetch(request())
    expect(await response.json()).toEqual({ status, type: 'about:blank', title })
  })

  it.each([418, 499, 599])('omits the title for an unused or unassigned status %i', async (status) => {
    const response = await app(() => new Response(null, { status })).fetch(request())
    expect(await response.json()).toEqual({ status, type: 'about:blank' })
  })

  it.each([200, 204, 302, 304])('leaves a non-error status %i unchanged', async (status) => {
    const original = new Response(null, { status })
    expect(await app(() => original).fetch(request())).toBe(original)
  })

  it('leaves a network-error response unchanged', async () => {
    const original = Response.error()
    expect(await app(() => original).fetch(request())).toBe(original)
  })

  it.each(['', 'custom error'])('preserves an existing body, including an empty string: %j', async (body) => {
    const original = new Response(body, { status: 500 })
    const response = await app(() => original).fetch(request())
    expect(response).toBe(original)
    expect(response.bodyUsed).toBe(false)
    expect(await response.text()).toBe(body)
  })

  it('does not consume or convert a later streaming failure', async () => {
    const original = new Response(new ReadableStream({
      start(controller) { controller.error(new Error('stream failed')) },
    }), { status: 500 })
    const onError = vi.fn()
    const response = await app(() => original, { onError }).fetch(request())
    expect(response).toBe(original)
    expect(response.bodyUsed).toBe(false)
    await expect(response.text()).rejects.toThrow('stream failed')
    expect(onError).not.toHaveBeenCalled()
  })

  it('can disable empty-response conversion while still handling thrown errors', async () => {
    const options = { emptyResponses: false, onError: () => {} }
    const original = new Response(null, { status: 404 })
    expect(await app(() => original, options).fetch(request())).toBe(original)
    const response = await app(() => { throw new Error('failure') }, options).fetch(request())
    expect(await response.json()).toEqual(internalProblem)
  })

  it('reports only thrown errors, not an empty 500 response', async () => {
    const onError = vi.fn()
    const response = await app(() => new Response(null, { status: 500 }), { onError }).fetch(request())
    expect(await response.json()).toEqual(internalProblem)
    expect(onError).not.toHaveBeenCalled()
  })

  it('keeps generated HEAD responses bodyless for both errors and empty responses', async () => {
    for (const handler of [() => { throw new Error('failure') }, () => new Response(null, { status: 404 })]) {
      const response = await app(handler, { onError: () => {} }).fetch(request('HEAD'))
      expect(response.headers.get('Content-Type')).toBe('application/problem+json')
      expect(response.body).toBeNull()
      expect(await response.text()).toBe('')
    }
  })
})

describe('router integration', () => {
  it.each([
    ['GET', '/missing', 404], ['POST', '/users/42', 405], ['GET', '/users/%FF', 400],
    ['HEAD', '/missing', 404],
  ] as const)('normalizes %s %s into a %i problem response', async (method, path, status) => {
    const handler = router(get('/users/:id', () => new Response('ok')))
    const response = await app(handler).fetch(new Request(`https://example.test${path}`, { method }))
    expect(response.status).toBe(status)
    if (status === 405) expect(response.headers.get('Allow')).toBe('GET, HEAD')
    if (method === 'HEAD') expect(response.body).toBeNull()
    else expect(await response.json()).toMatchObject({ status, type: 'about:blank' })
  })
})
