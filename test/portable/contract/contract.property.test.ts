import { expect, it } from 'vitest'
import fc from 'fast-check'
import { contract, toOpenApi } from '../../../src/contract/index.ts'
import { group, router, toFetch } from '../../../src/index.ts'
import { paramNameArbitrary, paramValueArbitrary, PROPERTY_OPTIONS, staticSegmentArbitrary } from '../arbitraries.ts'
import { definition, idSchema, info, limitSchema, schema, textSchema } from './fixtures.ts'

it('passes only valid transformed queries to the handler', async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: -100, max: 200 }), async (limit) => {
    let calls = 0
    const app = toFetch(router(contract({ ...definition, request: { query: { limit: { schema: limitSchema } } } }, (_req, _ctx, input) => {
      calls++
      expect(input.query.limit).toBe(limit)
      return new Response()
    })))
    const response = await app.fetch(new Request(`https://test/items?limit=${limit}`))
    const valid = limit >= 1 && limit <= 100
    expect(response.status).toBe(valid ? 200 : 422)
    expect(calls).toBe(valid ? 1 : 0)
  }), PROPERTY_OPTIONS)
})

it('keeps documented group paths aligned with matching and decoded parameters', async () => {
  await fc.assert(fc.asyncProperty(staticSegmentArbitrary, paramNameArbitrary, paramValueArbitrary, async (prefix, name, value) => {
    const route = group(`/${prefix}`, contract({ ...definition, path: `/:${name}`, request: { params: { [name]: { schema: textSchema } } } }, (_req, ctx, input) => {
      expect(ctx.params[name]).toBe(value)
      expect(input.params[name]).toBe(value)
      expect(Object.hasOwn(input.params, name)).toBe(true)
      return Response.json(input.params)
    }))
    const document = toOpenApi({ info }, route)
    const path = Object.keys(document.paths)[0]!
    const response = await toFetch(router(route)).fetch(new Request(`https://test${path.replace(`{${name}}`, encodeURIComponent(value))}`))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ [name]: value })
  }), PROPERTY_OPTIONS)
})

it('handles generated query/header names and URL decoding without prototype lookups', async () => {
  await fc.assert(fc.asyncProperty(paramNameArbitrary, paramValueArbitrary, async (name, value) => {
    const request = new Request(`https://test/items?${new URLSearchParams([[name, value]])}`, { headers: { 'X-Value': 'test' } })
    const response = await toFetch(router(contract({ ...definition, request: { query: { [name]: { schema: textSchema } }, headers: { 'x-value': { schema: textSchema } } } }, (_req, _ctx, input) => Response.json(input)))).fetch(request)
    expect(await response.json()).toEqual({ query: { [name]: value }, headers: { 'x-value': 'test' } })
  }), PROPERTY_OPTIONS)
})

it('does not conflate raw path strings with converted numeric IDs', async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 1000000 }), async (id) => {
    const item = contract({ ...definition, path: '/items/:id', request: { params: { id: { schema: idSchema } } } }, (_req, ctx, input) => {
      expect(ctx.params.id).toBe(String(id))
      expect(input.params.id).toBe(id)
      return new Response()
    })
    expect((await toFetch(router(item)).fetch(new Request(`https://test/items/${id}`))).status).toBe(200)
  }), PROPERTY_OPTIONS)
})

it('preserves successful JSON values across validation and response construction', async () => {
  await fc.assert(fc.asyncProperty(fc.jsonValue(), async (value) => {
    const item = contract({ ...definition, method: 'POST', request: { json: schema((input) => ({ value: input })) } }, (_req, _ctx, input) => Response.json(input.json))
    const body = JSON.stringify(value)
    const response = await toFetch(router(item)).fetch(new Request('https://test/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(JSON.parse(body))
  }), PROPERTY_OPTIONS)
})

it('keeps empty and hash root references inside schemas under encoded paths', () => {
  fc.assert(fc.property(staticSegmentArbitrary, fc.constantFrom('~', '%', '中', '#', ' '), (segment, special) => {
    const json = { type: 'object', properties: { empty: { $ref: '' }, hash: { $ref: '#' } } }
    const item = contract({ ...definition, path: `/${segment}${special}`, request: { json: schema((value) => ({ value }), json) } }, () => new Response())
    const document = toOpenApi({ info }, item)
    const embedded = Object.values(document.paths)[0]!.get!.requestBody!.content['application/json']!.schema as { properties: Record<string, { $ref: string }> }
    for (const { $ref } of Object.values(embedded.properties)) {
      expect($ref).toMatch(/^#\//)
      const tokens = decodeURIComponent($ref.slice(2)).split('/').map((token) => token.replaceAll('~1', '/').replaceAll('~0', '~'))
      const target = tokens.reduce<unknown>((value, token) => (value as Record<string, unknown>)[token], document)
      expect(target).toBe(embedded)
    }
  }), PROPERTY_OPTIONS)
})
