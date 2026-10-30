import { describe, expect, it, vi } from 'vitest'
import { contract } from '../../../src/contract/index.ts'
import type { ContractDefinition, ContractRequest, StandardSchemaV1 } from '../../../src/contract/index.ts'
import { contextKey, group, router, toFetch, withFilters } from '../../../src/index.ts'
import type { HttpFilter } from '../../../src/index.ts'
import { problemDetails } from '../../../src/filters/index.ts'
import { createSchema, cursorSchema, definition, idSchema, limitSchema, schema, textSchema } from './fixtures.ts'

function app(request: ContractRequest, handler = vi.fn(() => new Response('ok'))) {
  return { handler, ...toFetch(router(contract({ ...definition, path: '/items/:id', method: 'POST', request }, handler))) }
}

function post(body = '{}', headers: HeadersInit = { 'Content-Type': 'application/json' }, url = 'https://test/items/1') {
  return new Request(url, { method: 'POST', headers, body })
}

describe('Contract validation', () => {
  it('transforms params, applies defaults and preserves request/context data', async () => {
    const key = contextKey<string>('request-id')
    const req = new Request('https://test/teams/alpha/items/12?cursor=next&ignored=x', { headers: { 'X-Client': 'web' } })
    const handler = router<{ db: string }>(group('/teams/:team', contract({ ...definition, path: '/items/:id', request: {
      params: { id: { schema: idSchema }, team: { schema: textSchema } },
      query: { limit: { schema: limitSchema, required: false }, cursor: { schema: cursorSchema, required: false } },
      headers: { 'x-client': { schema: textSchema } },
    } }, (request, ctx, input) => {
      expect(request).toBe(req)
      expect(ctx.env).toEqual({ db: 'db' })
      expect(ctx.params).toEqual({ team: 'alpha', id: '12' })
      expect(key.get(ctx)).toBe('trace')
      expect(ctx.executionCtx).toBe(executionCtx)
      return Response.json(input)
    })))
    const executionCtx = { waitUntil: vi.fn() }
    const identify: HttpFilter = (next) => (request, ctx) => next(request, key.with(ctx, 'trace'))
    const response = await toFetch(withFilters(handler, identify)).fetch(req, { db: 'db' }, executionCtx)
    expect(await response.json()).toEqual({ params: { id: 12, team: 'alpha' }, query: { limit: 20, cursor: 'next' }, headers: { 'x-client': 'web' } })
    expect(req.bodyUsed).toBe(false)
  })

  it('consumes JSON once and passes the validated result without mutating the Request', async () => {
    const req = post('{"name":"new","extra":true}', { 'Content-Type': 'Application/JSON; charset=utf-8' })
    const response = await toFetch(router(contract({ ...definition, path: '/items/:id', method: 'POST', request: { json: createSchema } }, async (request, _ctx, input) => {
      expect(request).toBe(req)
      expect(request.bodyUsed).toBe(true)
      await expect(request.json()).rejects.toThrow()
      return Response.json(input.json, { status: 201 })
    }))).fetch(req)
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ name: 'new' })
  })

  it('collects all reported issues in source and declaration order', async () => {
    const nested = schema(() => ({ issues: [{ path: [{ key: 'entries' }, 0, Symbol('field')], message: 'First' }, { message: 'Second' }] }))
    const service = app({ params: { id: { schema: idSchema } }, query: { limit: { schema: limitSchema }, cursor: { schema: textSchema } }, headers: { 'x-client': { schema: textSchema } }, json: nested })
    const response = await service.fetch(post('{}', { 'Content-Type': 'application/json' }, 'https://test/items/no?limit=bad'))
    expect(response.status).toBe(422)
    expect(response.headers.get('Content-Type')).toBe('application/problem+json')
    expect(await response.json()).toEqual({ type: 'about:blank', title: 'Unprocessable Content', status: 422, errors: [
      { source: 'params', path: ['id'], message: 'Expected a positive integer' },
      { source: 'query', path: ['limit'], message: 'Expected a limit between 1 and 100' },
      { source: 'query', path: ['cursor'], message: 'Required value is missing' },
      { source: 'headers', path: ['x-client'], message: 'Required value is missing' },
      { source: 'json', path: ['entries', 0, 'Symbol(field)'], message: 'First' },
      { source: 'json', path: [], message: 'Second' },
    ] })
    expect(service.handler).not.toHaveBeenCalled()
  })

  it('rejects repeated scalar queries while ignoring undeclared fields', async () => {
    const service = app({ query: { limit: { schema: limitSchema, required: false } } })
    expect((await service.fetch(post('{}', {}, 'https://test/items/1?limit=1&limit=2'))).status).toBe(422)
    expect(service.handler).not.toHaveBeenCalled()
    expect((await service.fetch(post('{}', {}, 'https://test/items/1?extra=1&extra=2'))).status).toBe(200)
  })

  it.each([['{', 400], ['', 400], ['null', 422], ['{}', 422], ['{"name":""}', 422]])('classifies JSON body %j as %i', async (body, status) => {
    const service = app({ json: createSchema })
    expect((await service.fetch(post(body))).status).toBe(status)
    expect(service.handler).not.toHaveBeenCalled()
  })

  it('returns 400 for a missing required body and 415 for an unsupported media type', async () => {
    const service = app({ json: createSchema })
    expect((await service.fetch(new Request('https://test/items/1', { method: 'POST' }))).status).toBe(400)
    for (const contentType of ['text/plain', 'application/problem+json']) {
      expect((await service.fetch(post('{"name":"x"}', { 'Content-Type': contentType }))).status).toBe(415)
    }
    const withoutType = post('{"name":"x"}')
    withoutType.headers.delete('Content-Type')
    expect((await service.fetch(withoutType)).status).toBe(415)
    expect(service.handler).not.toHaveBeenCalled()
  })

  it('does not run validators when JSON parsing or media checks fail', async () => {
    const validate = vi.fn(() => ({ value: 'value' }))
    const service = app({ query: { q: { schema: schema(validate), required: false } }, json: schema(validate) })
    expect((await service.fetch(post('{'))).status).toBe(400)
    expect(validate).not.toHaveBeenCalled()
  })

  it('awaits async validation and preserves falsy successful values', async () => {
    for (const value of [undefined, false, null, 0, '']) {
      const response = new Response('ok')
      const handler = router(contract({ ...definition, request: { query: { q: { required: false, schema: schema(async () => ({ value })) } } } }, (_req, _ctx, input) => {
        expect(Object.hasOwn(input.query, 'q')).toBe(true)
        expect(input.query.q).toBe(value)
        return response
      }))
      expect(await toFetch(handler).fetch(new Request('https://test/items'))).toBe(response)
    }
  })

  it('propagates validator throws and rejections rather than reporting 422', async () => {
    for (const validate of [() => { throw 'failure' }, () => Promise.reject('failure')]) {
      const service = app({ json: schema(validate) })
      await expect(service.fetch(post())).rejects.toBe('failure')
      expect(service.handler).not.toHaveBeenCalled()
    }
  })

  it.each([null, {}, { issues: [] }, { issues: 'bad' }, { issues: [{ message: 1 }] }, { issues: [{ message: 'x', path: [null] }] }])('rejects a malformed validation result %j', async (result) => {
    const broken = { '~standard': { version: 1, vendor: 'broken', validate: () => result } } as unknown as StandardSchemaV1
    await expect(app({ json: broken }).fetch(post())).rejects.toThrow(TypeError)
  })

  it('lets the error filter handle invalid validators and does not rewrite 422 problems', async () => {
    const onError = vi.fn()
    const item = contract({ ...definition, request: { query: { q: { required: false, schema: schema(() => { throw new Error('secret') }) } } } }, () => new Response())
    const response = await toFetch(withFilters(router(item), problemDetails({ onError }))).fetch(new Request('https://test/items'))
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('secret')
    expect(onError).toHaveBeenCalledOnce()
  })

  it('preserves body read failures, including a SyntaxError from the stream', async () => {
    const error = new SyntaxError('read failed')
    const req = new Request('https://test/items/1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: new Blob(['{}']) })
    // The read is the I/O boundary; distinguish its error from JSON.parse's SyntaxError.
    const read = vi.spyOn(req, 'text').mockRejectedValue(error)
    try {
      await expect(app({ json: createSchema }).fetch(req)).rejects.toBe(error)
    } finally {
      read.mockRestore()
    }
  })

  it('never consumes undeclared request bodies or reads response streams', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    const response = new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value } }))
    const req = post()
    const result = await toFetch(router(contract({ ...definition, path: '/items/:id', method: 'POST' }, (request) => {
      expect(request.bodyUsed).toBe(false)
      return response
    }))).fetch(req)
    expect(result).toBe(response)
    expect(result.bodyUsed).toBe(false)
    controller!.enqueue(new TextEncoder().encode('chunk'))
    controller!.close()
    expect(await result.text()).toBe('chunk')
  })

  it('keeps HEAD validation errors bodyless and does not run the handler', async () => {
    const handler = vi.fn(() => new Response('ok'))
    const response = await toFetch(router(contract({ ...definition, request: { query: { q: { schema: textSchema } } } }, handler))).fetch(new Request('https://test/items', { method: 'HEAD' }))
    expect(response.status).toBe(422)
    expect(response.body).toBeNull()
    expect(handler).not.toHaveBeenCalled()
  })

  it('snapshots configuration without freezing application schemas', async () => {
    const parameter = { schema: textSchema, required: true }
    const request = { query: { q: parameter } }
    const item = contract({ ...definition, request }, (_req, _ctx, input) => Response.json(input))
    parameter.required = false
    parameter.schema = schema(() => ({ value: 'changed' }))
    expect((await toFetch(router(item)).fetch(new Request('https://test/items'))).status).toBe(422)
    expect(Object.isFrozen(textSchema)).toBe(false)
  })

  it.each([null, {}, { ...definition, operationId: '' }, { ...definition, request: { query: { q: { schema: {} } } } }, { ...definition, request: { params: { id: { schema: textSchema, required: false } } } }, { ...definition, request: { headers: { 'X-A': { schema: textSchema }, 'x-a': { schema: textSchema } } } }])('rejects malformed definitions %j', (value) => {
    expect(() => contract(value as unknown as ContractDefinition, () => new Response())).toThrow(TypeError)
  })

  it('checks full path parameters during router construction, including enclosing groups', () => {
    const item = contract({ ...definition, request: { params: { team: { schema: textSchema } } } }, () => new Response())
    expect(() => router(item)).toThrow(/team/)
    expect(() => router(group('/teams/:team', item))).not.toThrow()
  })
})
