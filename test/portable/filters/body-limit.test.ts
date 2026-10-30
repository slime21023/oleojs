import { describe, expect, it, vi } from 'vitest'
import { contract } from '../../../src/contract/index.ts'
import { bodyLimit, problemDetails } from '../../../src/filters/index.ts'
import type { BodyLimitOptions } from '../../../src/filters/index.ts'
import { router, toFetch, withFilters } from '../../../src/index.ts'
import type { Context, HttpHandler } from '../../../src/index.ts'
import { EMPTY_PARAMS, STUB_EXECUTION_CTX } from '../../../src/context-defaults.ts'
import { createSchema, definition } from '../contract/fixtures.ts'

const context: Context = { params: EMPTY_PARAMS, env: undefined, executionCtx: STUB_EXECUTION_CTX }
const url = 'https://api.test/upload?x=1'
const bytes = (...values: number[]) => new Uint8Array(values)

// Streaming request bodies need runtime-specific duplex support, so these tests give a byte-bodied
// Request a different body stream. The filter reads the body only through `req.body`.
function withBodyStream(chunks: readonly unknown[]) {
  const cancel = vi.fn()
  let pulled = 0
  const stream = new ReadableStream({
    pull(controller) {
      if (pulled === chunks.length) controller.close()
      else controller.enqueue(chunks[pulled++])
    },
    cancel,
  }, { highWaterMark: 0 })
  const req = new Request(url, { method: 'POST', body: 'placeholder' })
  Object.defineProperty(req, 'body', { value: stream })
  return { req, cancel, pulled: () => pulled }
}

const echo = vi.fn<HttpHandler>(async (req) => new Response(await req.arrayBuffer(), {
  headers: { 'X-Method': req.method, 'X-Url': req.url, 'X-Trace': req.headers.get('X-Trace') ?? '' },
}))

describe('bodyLimit', () => {
  it.each([undefined, null, [], {}, { maxBytes: -1 }, { maxBytes: 1.5 }, { maxBytes: '1' }, { maxBytes: Number.NaN }, { maxBytes: 2 ** 53 }])(
    'rejects invalid options at construction: %j',
    (options) => {
      expect(() => bodyLimit(options as BodyLimitOptions)).toThrow(TypeError)
    },
  )

  it('passes a request without a body through unchanged', async () => {
    const req = new Request(url)
    const next = vi.fn<HttpHandler>(() => new Response('ok'))
    await withFilters(next, bodyLimit({ maxBytes: 0 }))(req, context)
    expect(next).toHaveBeenCalledWith(req, context)
  })

  it('forwards a body at the limit in a new request with the same method, URL and headers', async () => {
    const original = new Request(url, { method: 'PUT', body: 'hello', headers: { 'X-Trace': 'abc' } })
    const res = await withFilters(echo, bodyLimit({ maxBytes: 5 }))(original, context)
    expect(echo.mock.lastCall?.[0]).not.toBe(original)
    expect(echo.mock.lastCall?.[1]).toBe(context)
    expect(await res.text()).toBe('hello')
    expect([res.headers.get('X-Method'), res.headers.get('X-Url'), res.headers.get('X-Trace')]).toEqual(['PUT', url, 'abc'])
  })

  it('accepts an empty body with a zero limit', async () => {
    const res = await withFilters(echo, bodyLimit({ maxBytes: 0 }))(new Request(url, { method: 'POST', body: '' }), context)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })

  it('rejects a body over the limit with an empty 413 without invoking the handler', async () => {
    const next = vi.fn<HttpHandler>(() => new Response('ok'))
    const res = await withFilters(next, bodyLimit({ maxBytes: 4 }))(new Request(url, { method: 'POST', body: 'hello' }), context)
    expect(res.status).toBe(413)
    expect(res.body).toBeNull()
    expect(next).not.toHaveBeenCalled()
  })

  it('concatenates chunks within the limit', async () => {
    const { req } = withBodyStream([bytes(1, 2), bytes(), bytes(3, 4, 5)])
    const res = await withFilters(echo, bodyLimit({ maxBytes: 5 }))(req, context)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes(1, 2, 3, 4, 5))
  })

  it('stops reading and cancels the source as soon as the limit is exceeded', async () => {
    const { req, cancel, pulled } = withBodyStream([bytes(1, 2, 3), bytes(4, 5, 6), bytes(7, 8, 9)])
    const next = vi.fn<HttpHandler>(() => new Response('ok'))
    const res = await withFilters(next, bodyLimit({ maxBytes: 5 }))(req, context)
    expect(res.status).toBe(413)
    expect(next).not.toHaveBeenCalled()
    expect(pulled()).toBe(2)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('cancels the source and throws for chunks that are not bytes', async () => {
    const { req, cancel } = withBodyStream(['text'])
    await expect(withFilters(echo, bodyLimit({ maxBytes: 10 }))(req, context)).rejects.toThrow(TypeError)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('propagates body stream failures', async () => {
    const failure = new Error('client went away')
    const req = new Request(url, { method: 'POST', body: 'placeholder' })
    Object.defineProperty(req, 'body', { value: new ReadableStream({ start(controller) { controller.error(failure) } }) })
    await expect(withFilters(echo, bodyLimit({ maxBytes: 10 }))(req, context)).rejects.toBe(failure)
  })

  it('lets problemDetails render the 413 as a problem document', async () => {
    const app = withFilters(echo, problemDetails(), bodyLimit({ maxBytes: 1 }))
    const res = await app(new Request(url, { method: 'POST', body: 'too large' }), context)
    expect(res.status).toBe(413)
    expect(res.headers.get('Content-Type')).toBe('application/problem+json')
    expect(await res.json()).toEqual({ type: 'about:blank', title: 'Content Too Large', status: 413 })
  })

  it('bounds the JSON body read by a contract route', async () => {
    const create = contract({ ...definition, method: 'POST', request: { json: createSchema } },
      (_req, _ctx, { json }) => Response.json(json, { status: 201 }))
    const app = toFetch(withFilters(router(create), bodyLimit({ maxBytes: 16 })))
    const post = (body: string) => app.fetch(new Request(`https://api.test${definition.path}`, {
      method: 'POST', body, headers: { 'Content-Type': 'application/json' },
    }))
    expect((await post('{"name":"short"}')).status).toBe(201)
    expect((await post('{"name":"far too long"}')).status).toBe(413)
  })
})
