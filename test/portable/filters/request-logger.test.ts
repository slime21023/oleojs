import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestLogger } from '../../../src/filters/index.ts'
import type { RequestLoggerOptions } from '../../../src/filters/index.ts'
import { toFetch } from '../../../src/index.ts'

const request = () => new Request('https://example.test/users/a%2Fb?token=private#secret', {
  method: 'POST', headers: { Authorization: 'Bearer confidential' },
})

afterEach(() => vi.restoreAllMocks())

describe('requestLogger options', () => {
  it.each([null, [], true, 'options', { log: null }, { log: 'console' }, { fields: 1 }])('rejects invalid options at construction: %j', (options) => {
    expect(() => requestLogger(options as RequestLoggerOptions)).toThrow(TypeError)
  })
})

describe('request outcome logging', () => {
  it('prints one JSON entry by default without query, fragment, or authorization data', async () => {
    const print = vi.spyOn(console, 'log').mockImplementation(() => {})
    const response = new Response('ok', { status: 201 })
    expect(await toFetch(requestLogger()(() => response)).fetch(request())).toBe(response)
    expect(print).toHaveBeenCalledOnce()
    const serialized = print.mock.calls[0]?.[0] as string
    expect(JSON.parse(serialized)).toEqual({ method: 'POST', path: '/users/a%2Fb', status: 201, durationMs: expect.any(Number) })
    expect(serialized).not.toContain('private')
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('confidential')
  })

  it('rounds handler duration to one decimal place and excludes callback time', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(101.26)
    const log = vi.fn()
    await toFetch(requestLogger({ log })(() => new Response())).fetch(request())
    expect(log).toHaveBeenCalledExactlyOnceWith({ method: 'POST', path: '/users/a%2Fb', status: 200, durationMs: 1.3 })
  })

  it.each([undefined, null, false, 'private error', new Error('failure')])('records and preserves any thrown value: %s', async (error) => {
    const log = vi.fn()
    const fields = vi.fn(() => ({ status: 999, error: false, trace: 'abc' }))
    const req = request()
    const app = toFetch(requestLogger({ log, fields })(() => { throw error }))
    await expect(app.fetch(req)).rejects.toBe(error)
    expect(fields).toHaveBeenCalledExactlyOnceWith(req, undefined)
    expect(log).toHaveBeenCalledExactlyOnceWith({ method: 'POST', path: '/users/a%2Fb', error: true, durationMs: expect.any(Number), trace: 'abc' })
    expect(log.mock.calls[0]?.[0]).not.toHaveProperty('status')
  })

  it('records promise rejection without swallowing it', async () => {
    const error = new Error('async failure')
    const log = vi.fn()
    await expect(toFetch(requestLogger({ log })(() => Promise.reject(error))).fetch(request())).rejects.toBe(error)
    expect(log).toHaveBeenCalledOnce()
    expect(log.mock.calls[0]?.[0]).toMatchObject({ error: true })
  })

  it('passes request and response to fields while protecting every core field', async () => {
    const extra = Object.freeze({ method: 'BAD', path: '/bad', status: 999, durationMs: -1, error: true, trace: 'abc' })
    const fields = vi.fn(() => extra)
    const log = vi.fn()
    const req = request()
    const original = new Response('ok', { status: 202 })
    const response = await toFetch(requestLogger({ fields, log })(() => original)).fetch(req)
    expect(response).toBe(original)
    expect(fields).toHaveBeenCalledExactlyOnceWith(req, original)
    expect(log).toHaveBeenCalledExactlyOnceWith({ method: 'POST', path: '/users/a%2Fb', status: 202, durationMs: expect.any(Number), trace: 'abc' })
    expect(log.mock.calls[0]?.[0]).not.toHaveProperty('error')
    expect(extra.status).toBe(999)
  })

  it('prevents a fields serialization hook from replacing the core entry', async () => {
    const print = vi.spyOn(console, 'log').mockImplementation(() => {})
    await toFetch(requestLogger({ fields: () => ({ toJSON: () => ({ status: 999 }), trace: 'abc' }) })(() => new Response())).fetch(request())
    expect(JSON.parse(print.mock.calls[0]?.[0] as string)).toMatchObject({ status: 200, trace: 'abc' })
  })

  it('does not consume or wait for a response body and does not reinterpret later stream errors', async () => {
    const log = vi.fn()
    const original = new Response(new ReadableStream({ start(controller) { controller.error(new Error('body failed')) } }))
    const response = await toFetch(requestLogger({ log })(() => original)).fetch(request())
    expect(response).toBe(original)
    expect(response.bodyUsed).toBe(false)
    expect(log).toHaveBeenCalledOnce()
    expect(log.mock.calls[0]?.[0]).toMatchObject({ status: 200 })
    await expect(response.text()).rejects.toThrow('body failed')
    expect(log).toHaveBeenCalledOnce()
  })

  it('records a network-error response as status zero', async () => {
    const log = vi.fn()
    const response = Response.error()
    expect(await toFetch(requestLogger({ log })(() => response)).fetch(request())).toBe(response)
    expect(log.mock.calls[0]?.[0]).toMatchObject({ status: 0 })
  })
})

describe('logging failure isolation', () => {
  it.each(['throw', 'getter'])('still emits the core entry when fields fail through %s', async (mode) => {
    const failure = new Error('fields failed')
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = vi.fn()
    const response = new Response('ok')
    const fields = () => {
      if (mode === 'throw') throw failure
      return { get trace(): string { throw failure } }
    }
    expect(await toFetch(requestLogger({ fields, log })(() => response)).fetch(request())).toBe(response)
    expect(report).toHaveBeenCalledExactlyOnceWith(failure)
    expect(log).toHaveBeenCalledExactlyOnceWith({ method: 'POST', path: '/users/a%2Fb', status: 200, durationMs: expect.any(Number) })
  })

  it.each(['throw', 'reject'])('keeps a response when log can %s', async (mode) => {
    const failure = new Error('logging failed')
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = new Response('ok')
    const log = () => { if (mode === 'reject') return Promise.reject(failure); throw failure }
    expect(await toFetch(requestLogger({ log })(() => response)).fetch(request())).toBe(response)
    expect(report).toHaveBeenCalledExactlyOnceWith(failure)
  })

  it('keeps the original rejection when both fields and log fail', async () => {
    const original = new Error('handler failed')
    const fieldFailure = new Error('fields failed')
    const logFailure = new Error('log failed')
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = toFetch(requestLogger({
      fields: () => { throw fieldFailure },
      log: () => { throw logFailure },
    })(() => { throw original }))
    await expect(app.fetch(request())).rejects.toBe(original)
    expect(report.mock.calls.map(([error]) => error)).toEqual([fieldFailure, logFailure])
  })

  it('isolates serialization errors in the default logger', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = new Response('ok')
    expect(await toFetch(requestLogger({ fields: () => ({ value: 1n }) })(() => response)).fetch(request())).toBe(response)
    expect(report).toHaveBeenCalledOnce()
  })
})
