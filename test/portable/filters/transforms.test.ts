import { describe, expect, it, vi } from 'vitest'
import { mapRequest, mapResponse, problemDetails } from '../../../src/filters/index.ts'
import type { RequestTransform, ResponseTransform } from '../../../src/filters/index.ts'
import { contextKey, get, group, router, toFetch, withFilters } from '../../../src/index.ts'
import type { Context } from '../../../src/index.ts'

interface Env { marker: string }
const context: Context<Env> = { params: {}, env: { marker: 'env' }, executionCtx: { waitUntil() {} } }
const request = () => new Request('https://api.test/items/42?query=keep')

describe('mapRequest', () => {
  it.each([undefined, null, 1, {}])('rejects invalid transforms at construction: %j', (value) => {
    expect(() => mapRequest(value as RequestTransform)).toThrow(TypeError)
  })

  it('awaits the transformed request and forwards the same context', async () => {
    const original = request()
    const next = vi.fn((req: Request, ctx: Context<Env>) => {
      expect(ctx).toBe(context)
      expect(req).not.toBe(original)
      expect(req.url).toBe(original.url)
      return new Response(req.headers.get('X-Marker'))
    })
    const app = withFilters(next, mapRequest(async (req, ctx) => {
      expect(req).toBe(original)
      const headers = new Headers(req.headers)
      headers.set('X-Marker', ctx.env.marker)
      return new Request(req, { headers })
    }))
    expect(await (await app(original, context)).text()).toBe('env')
    expect(next).toHaveBeenCalledTimes(1)
    expect(original.headers.has('X-Marker')).toBe(false)
  })

  it('can rewrite a request before routing', async () => {
    const app = toFetch(withFilters(router(get('/new/:id', (_req, ctx) => new Response(ctx.params.id))),
      mapRequest((req) => new Request(req.url.replace('/items/', '/new/'), req)),
    ))
    expect(await (await app.fetch(request())).text()).toBe('42')
  })

  it.each([false, true])('propagates transformation errors before next runs (async=%s)', async (asynchronous) => {
    const error = new Error('request transform failed')
    const next = vi.fn(() => new Response())
    const app = withFilters(next, mapRequest(() => {
      if (asynchronous) return Promise.reject(error)
      throw error
    }))
    await expect(app(request(), context)).rejects.toBe(error)
    expect(next).not.toHaveBeenCalled()
  })

  it('propagates downstream failures', async () => {
    const error = new Error('handler failed')
    const app = withFilters(() => { throw error }, mapRequest((req) => req))
    await expect(app(request(), context)).rejects.toBe(error)
  })
})

describe('mapResponse', () => {
  it.each([undefined, null, 1, {}])('rejects invalid transforms at construction: %j', (value) => {
    expect(() => mapResponse(value as ResponseTransform)).toThrow(TypeError)
  })

  it('awaits the handler and an asynchronous transform with the original request and context', async () => {
    const req = request()
    const original = new Response('original', { status: 202 })
    const app = withFilters(async () => original, mapResponse(async (res, received, ctx) => {
      expect(res).toBe(original)
      expect(received).toBe(req)
      expect(ctx).toBe(context)
      return new Response((await res.text()).toUpperCase(), { status: res.status })
    }))
    const response = await app(req, context)
    expect(response.status).toBe(202)
    expect(await response.text()).toBe('ORIGINAL')
  })

  it('does not consume a streaming body', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const original = new Response(new ReadableStream({ start(value) { controller = value } }))
    const response = await withFilters(() => original, mapResponse((res) => res))(request(), context)
    expect(response).toBe(original)
    expect(response.bodyUsed).toBe(false)
    controller?.enqueue(new TextEncoder().encode('stream'))
    controller?.close()
    expect(await response.text()).toBe('stream')
  })

  it.each([false, true])('skips transformation when next fails (async=%s)', async (asynchronous) => {
    const error = new Error('handler failed')
    const transform = vi.fn((res: Response) => res)
    const app = withFilters(() => {
      if (asynchronous) return Promise.reject(error)
      throw error
    }, mapResponse(transform))
    await expect(app(request(), context)).rejects.toBe(error)
    expect(transform).not.toHaveBeenCalled()
  })

  it.each([false, true])('propagates transformation failures (async=%s)', async (asynchronous) => {
    const error = new Error('response transform failed')
    const app = withFilters(() => new Response(), mapResponse(() => {
      if (asynchronous) return Promise.reject(error)
      throw error
    }))
    await expect(app(request(), context)).rejects.toBe(error)
  })

  it('uses the context at its own position in the filter stack', async () => {
    const key = contextKey<string>('value')
    const app = toFetch(withFilters(router(group('/items/:id', { filters: [
      mapResponse((res, _req, ctx) => {
        expect(ctx.params.id).toBe('42')
        expect(key.find(ctx)).toBeUndefined()
        return res
      }),
    ] }, get('', (_req, ctx) => new Response(key.get(key.with(ctx, 'derived')))))), mapResponse((res, _req, ctx) => {
      expect(ctx.params).toEqual({})
      expect(key.find(ctx)).toBeUndefined()
      return res
    })))
    expect(await (await app.fetch(request())).text()).toBe('derived')
  })

  it('lets an outer problemDetails filter render transformation errors', async () => {
    const error = new Error('private error')
    const onError = vi.fn()
    const app = toFetch(withFilters(() => new Response(),
      problemDetails({ onError }),
      mapResponse(() => { throw error }),
    ))
    const response = await app.fetch(request())
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ status: 500, title: 'Internal Server Error' })
    expect(onError).toHaveBeenCalledWith(error, expect.any(Request))
  })
})
