import { describe, expect, it, vi } from 'vitest'
import { contract, toOpenApi } from '../../../src/contract/index.ts'
import type { ContractDefinition, OpenApiOptions, SecurityScheme, StandardSchemaV1 } from '../../../src/contract/index.ts'
import { get, group, router, toFetch } from '../../../src/index.ts'
import type { HttpFilter, Route } from '../../../src/index.ts'
import { createSchema, definition, idSchema, info, limitSchema, schema, textSchema } from './fixtures.ts'

const response = { description: 'Item', content: { 'application/json': { schema: createSchema } } }

function documentFor(json: Record<string, unknown>) {
  return toOpenApi({ info }, contract({ ...definition, request: { json: schema((value) => ({ value }), json) } }, () => new Response()))
}

function resolvePointer(root: unknown, reference: string): unknown {
  return decodeURIComponent(reference.slice(2)).split('/').reduce((value: unknown, key) => {
    const name = key.replaceAll('~1', '/').replaceAll('~0', '~')
    return (value as Record<string, unknown>)[name]
  }, root)
}

describe('OpenAPI generation', () => {
  it.each(['__proto__', 'constructor', 'toString'])('documents an unvalidated path parameter named %s as a string', (name) => {
    const item = contract({ ...definition, path: `/:${name}`, request: { params: {} } }, () => new Response())
    const document = toOpenApi({ info }, item)
    expect(document.paths[`/{${name}}`]!.get!.parameters).toEqual([{ name, in: 'path', required: true, schema: { type: 'string' } }])
  })

  it('uses full canonical paths, merges methods, and documents inferred group parameters', () => {
    const document = toOpenApi({ info }, group('/café/:team',
      contract({ ...definition, path: '/items/:id/', request: { params: { id: { schema: idSchema } }, query: { limit: { schema: limitSchema, required: false } } }, responses: { 200: response } }, () => new Response()),
      contract({ ...definition, path: '/items/:id/', method: 'POST', operationId: 'createItem', request: { json: createSchema }, responses: { 201: response } }, () => new Response()),
    ))
    expect(document.openapi).toBe('3.1.1')
    const operations = document.paths['/caf%C3%A9/{team}/items/{id}/']!
    expect(Object.keys(operations)).toEqual(['get', 'post'])
    expect(operations.get!.parameters).toEqual([
      { name: 'team', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[1-9][0-9]*$' } },
      { name: 'limit', in: 'query', required: false, schema: { type: 'string', pattern: '^(?:[1-9][0-9]?|100)$', default: '20' } },
    ])
    expect(operations.post!.requestBody).toEqual({ required: true, content: { 'application/json': { schema: createSchema['~standard'].jsonSchema!.input({ target: 'draft-2020-12' }) } } })
    expect(operations.get!.responses['400']).toBeDefined()
    expect(operations.get!.responses['415']).toBeUndefined()
    expect(operations.get!.responses['422']).toBeDefined()
    expect(Object.keys(operations.post!.responses)).toEqual(['201', '400', '415', '422'])
  })

  it('does not execute filters, handlers, or validators and omits ordinary routes', () => {
    const validate = vi.fn(() => ({ value: '' }))
    const handler = vi.fn(() => new Response())
    const filter: HttpFilter = vi.fn((next) => next)
    const item: Route = contract({ ...definition, request: { query: { q: { schema: schema(validate) } } } }, handler)
    const document = toOpenApi({ info }, group('/api', { filters: [filter] }, item, get('/health', handler)))
    expect(Object.keys(document.paths)).toEqual(['/api/items'])
    expect(filter).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
    expect(validate).not.toHaveBeenCalled()
    expect(document.paths['/api/items']!.get!.responses['400']).toBeUndefined()
  })

  it('lets explicit responses replace generated errors completely', () => {
    const document = toOpenApi({ info }, contract({ ...definition, request: { json: createSchema }, responses: {
      201: response, 422: { description: 'Application validation response' },
    } }, () => new Response()))
    const responses = document.paths['/items']!.get!.responses
    expect(responses['422']).toEqual({ description: 'Application validation response' })
    expect(responses['400']!.content!['application/problem+json']!.schema).toMatchObject({ properties: { status: { const: 400 } } })
  })

  it('documents the generated 422 issue structure', () => {
    const document = toOpenApi({ info }, contract({ ...definition, request: { headers: { 'X-Client': { schema: textSchema, description: 'Client identifier' } } } }, () => new Response()))
    expect(document.paths['/items']!.get!.parameters![0]).toMatchObject({ name: 'X-Client', in: 'header', required: true, description: 'Client identifier' })
    expect(document.paths['/items']!.get!.responses['422']!.content!['application/problem+json']!.schema).toMatchObject({
      required: ['type', 'title', 'status', 'errors'], properties: { errors: { items: { required: ['source', 'path', 'message'] } } },
    })
  })

  it('uses explicit exporters before native exporters and preserves input/output direction', () => {
    const native = vi.fn(() => ({}))
    const value: StandardSchemaV1 = { '~standard': { ...textSchema['~standard'], jsonSchema: { input: native, output: native } } }
    const convert = vi.fn((_schema: StandardSchemaV1, direction: 'input' | 'output') => ({ title: direction }))
    const document = toOpenApi({ info, toJsonSchema: convert }, contract({ ...definition, request: { json: value }, responses: { 200: { description: 'value', content: { 'application/json': { schema: value } } } } }, () => new Response()))
    expect(document.paths['/items']!.get!.requestBody!.content['application/json']!.schema).toEqual({ title: 'input' })
    expect(document.paths['/items']!.get!.responses['200']!.content!['application/json']!.schema).toEqual({ title: 'output' })
    expect(native).not.toHaveBeenCalled()
    expect(convert).toHaveBeenCalledTimes(2)
  })

  it('keeps runtime validation usable without any JSON Schema exporter', async () => {
    const value: StandardSchemaV1 = { '~standard': { version: 1, vendor: 'custom', validate: () => ({ value: 'ok' }) } }
    const item = contract({ ...definition, request: { query: { q: { schema: value, required: false } } } }, () => new Response('ok'))
    expect((await toFetch(router(item)).fetch(new Request('https://test/items'))).status).toBe(200)
    expect(() => toOpenApi({ info }, item)).toThrow(/exporter/)
    expect(() => toOpenApi({ info, toJsonSchema: () => true }, item)).not.toThrow()
  })

  it('requests the 2020-12 target and never hides exporter failures', () => {
    const input = vi.fn(() => { throw new Error('cannot export transformation') })
    const value: StandardSchemaV1 = { '~standard': { ...textSchema['~standard'], jsonSchema: { input, output: () => ({}) } } }
    expect(() => toOpenApi({ info }, contract({ ...definition, request: { query: { q: { schema: value } } } }, () => new Response()))).toThrow('cannot export transformation')
    expect(input).toHaveBeenCalledExactlyOnceWith({ target: 'draft-2020-12' })
  })

  it('rebases recursive refs and local definitions without changing data-valued keywords', () => {
    const original = { $defs: { entry: { type: 'string' } }, properties: { name: { $ref: '#/$defs/entry' }, child: { $ref: '#' } }, examples: [{ $ref: '#/literal' }], const: { $id: 'data', $ref: '#/data' } }
    const document = documentFor(original)
    const embedded = document.paths['/items']!.get!.requestBody!.content['application/json']!.schema as Record<string, unknown>
    const properties = embedded.properties as Record<string, { $ref: string }>
    expect(resolvePointer(document, properties.name!.$ref)).toEqual({ type: 'string' })
    expect(resolvePointer(document, properties.child!.$ref)).toBe(embedded)
    expect(embedded.examples).toEqual(original.examples)
    expect(embedded.const).toEqual(original.const)
    expect(original.properties.name.$ref).toBe('#/$defs/entry')
  })

  it('rebases anchors while preserving independent resource IDs and external refs', () => {
    const document = documentFor({ $defs: {
      local: { $anchor: 'name', type: 'string' },
      resource: { $id: 'https://schemas.test/tree', $dynamicAnchor: 'node', properties: { child: { $dynamicRef: '#node' } } },
    }, properties: { name: { $ref: '#name' }, external: { $ref: 'https://schemas.test/other' } } })
    const embedded = document.paths['/items']!.get!.requestBody!.content['application/json']!.schema as Record<string, unknown>
    const properties = embedded.properties as Record<string, { $ref: string }>
    expect(resolvePointer(document, properties.name!.$ref)).toEqual({ type: 'string' })
    expect(properties.external!.$ref).toBe('https://schemas.test/other')
    expect(embedded.$defs).toMatchObject({ resource: { $id: 'https://schemas.test/tree', properties: { child: { $dynamicRef: '#node' } } } })
  })

  it.each(['', '#'])('keeps root reference %j within each embedded request and response schema', (ref) => {
    const original = { type: 'object', properties: { child: { $ref: ref } }, examples: [{ $ref: '' }], const: { $ref: '' } }
    const value = schema((input) => ({ value: input }), original)
    const document = toOpenApi({ info }, contract({ ...definition, method: 'POST', request: { json: value }, responses: {
      200: { description: 'Recursive data', content: { 'application/json': { schema: value } } },
    } }, () => new Response()))
    const operation = document.paths['/items']!.post!
    const requestSchema = operation.requestBody!.content['application/json']!.schema
    const responseSchema = operation.responses['200']!.content!['application/json']!.schema
    for (const embedded of [requestSchema, responseSchema]) {
      const properties = (embedded as Record<string, unknown>).properties as { child: { $ref: string } }
      expect(properties.child.$ref).toMatch(/^#\//)
      expect(resolvePointer(document, properties.child.$ref)).toBe(embedded)
      expect(embedded).toMatchObject({ examples: original.examples, const: original.const })
    }
    expect(original.properties.child.$ref).toBe(ref)
  })

  it('preserves empty references in root and nested resources with explicit IDs', () => {
    const resource = { $id: 'https://schemas.test/tree', properties: { child: { $ref: '' } } }
    const root = documentFor(resource).paths['/items']!.get!.requestBody!.content['application/json']!.schema
    expect(root).toEqual(resource)
    const nested = documentFor({ $defs: { tree: resource }, properties: { child: { $ref: '' } } })
    const embedded = nested.paths['/items']!.get!.requestBody!.content['application/json']!.schema as Record<string, unknown>
    expect(embedded.$defs).toEqual({ tree: resource })
    const properties = embedded.properties as { child: { $ref: string } }
    expect(properties.child.$ref).toMatch(/^#\//)
    expect(resolvePointer(nested, properties.child.$ref)).toBe(embedded)
  })

  it('escapes pointer tokens in paths, parameter names and media types', () => {
    const value = schema((input) => ({ value: input }), { $defs: { text: { type: 'string' } }, $ref: '#/$defs/text' })
    const document = toOpenApi({ info }, contract({ ...definition, path: '/a~b/中', responses: { 200: { description: '', content: { 'application/vnd.x+json': { schema: value } } } } }, () => new Response()))
    const embedded = document.paths['/a~b/%E4%B8%AD']!.get!.responses['200']!.content!['application/vnd.x+json']!.schema as { $ref: string }
    expect(resolvePointer(document, embedded.$ref)).toEqual({ type: 'string' })
  })

  it.each([{ $ref: '#missing' }, { $dynamicRef: '#node' }, { properties: { bad: null } }, { allOf: {} }, { $anchor: 'invalid anchor' }])('rejects unsupported or malformed schema %j', (json) => {
    expect(() => documentFor(json)).toThrow(TypeError)
  })

  it('rejects cyclic and non-JSON schema values without invoking serialization hooks', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => documentFor(cyclic)).toThrow(TypeError)
    const hook = vi.fn(() => ({}))
    expect(() => documentFor({ toJSON: hook })).toThrow(TypeError)
    expect(hook).not.toHaveBeenCalled()
  })

  it('does not share document containers with declarations or other generated documents', () => {
    const security = { bearer: [] as string[] }
    const declaration = { ...definition, responses: { 200: { ...response } }, security: [security] }
    const item = contract(declaration, () => new Response())
    declaration.responses[200].description = 'changed'
    security.bearer.push('changed')
    const options: OpenApiOptions = { info, securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } }
    const first = toOpenApi(options, item)
    const second = toOpenApi(options, item)
    expect(first.paths['/items']!.get!.responses['200']!.description).toBe('Item')
    expect(first.paths['/items']!.get!.security).toEqual([{ bearer: [] }])
    expect(first.info).not.toBe(options.info)
    expect(first.paths).not.toBe(second.paths)
  })

  it('validates security references but does not infer runtime authentication or response codes', () => {
    const item = contract({ ...definition, security: [{ bearer: [] }] }, () => new Response())
    expect(() => toOpenApi({ info }, item)).toThrow(/Unknown security/)
    const document = toOpenApi({ info, securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } }, item)
    expect(document.paths['/items']!.get!.security).toEqual([{ bearer: [] }])
    expect(Object.keys(document.paths['/items']!.get!.responses)).toEqual(['200'])
    const withRoles = contract({ ...definition, security: [{ bearer: ['admin'] }] }, () => new Response())
    expect(toOpenApi({ info, securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } }, withRoles).paths['/items']!.get!.security).toEqual([{ bearer: ['admin'] }])
  })

  it.each<SecurityScheme>([
    { type: 'http', scheme: 'basic', description: 'Basic authentication' },
    { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    { type: 'apiKey', name: 'x-api-key', in: 'header' },
    { type: 'openIdConnect', openIdConnectUrl: 'https://identity.test/.well-known/openid-configuration' },
    { type: 'mutualTLS' },
    { type: 'oauth2', flows: {
      implicit: { authorizationUrl: 'https://identity.test/authorize', scopes: { read: 'Read' } },
      password: { tokenUrl: 'https://identity.test/token', scopes: {} },
      clientCredentials: { tokenUrl: 'https://identity.test/token', scopes: {} },
      authorizationCode: { authorizationUrl: 'https://identity.test/authorize', tokenUrl: 'https://identity.test/token', refreshUrl: 'https://identity.test/refresh', scopes: {} },
    } },
  ])('preserves supported security metadata %j', (scheme) => {
    const names = scheme.type === 'oauth2' || scheme.type === 'openIdConnect' ? ['read'] : ['admin']
    for (const requirements of [[], names]) {
      const item = contract({ ...definition, security: [{ auth: requirements }] }, () => new Response())
      const document = toOpenApi({ info, securitySchemes: { auth: scheme } }, item)
      expect(document.components!.securitySchemes.auth).toEqual(scheme)
      expect(document.paths['/items']!.get!.security).toEqual([{ auth: requirements }])
    }
  })

  it.each(['admin', null, [42], ['admin', false]])('rejects invalid security requirement values %j', (values) => {
    const invalid = { ...definition, security: [{ auth: values }] } as unknown as ContractDefinition
    expect(() => contract(invalid, () => new Response())).toThrow(TypeError)
  })

  it.each([
    { type: 'unknown' }, { type: 'http', scheme: '' }, { type: 'http', scheme: 'basic', bearerFormat: 'JWT' },
    { type: 'apiKey', name: 'key', in: 'body' }, { type: 'openIdConnect' },
    { type: 'oauth2', flows: { implicit: { scopes: {} } } },
    { type: 'oauth2', flows: { password: { scopes: {} } } },
    { type: 'oauth2', flows: { unsupported: { scopes: {} } } },
    { type: 'oauth2', flows: { clientCredentials: { tokenUrl: '/token', scopes: { read: 42 } } } },
  ])('rejects malformed security metadata %j', (scheme) => {
    expect(() => toOpenApi({ info, securitySchemes: { auth: scheme as unknown as SecurityScheme } })).toThrow(TypeError)
  })

  it.each(['Authorization', 'Accept', 'Content-Type'])('rejects ignored OpenAPI header parameter %s', (name) => {
    const item = contract({ ...definition, request: { headers: { [name]: { schema: textSchema } } } }, () => new Response())
    expect(() => toOpenApi({ info }, item)).toThrow(/OpenAPI ignores/)
  })

  it('rejects duplicate IDs, duplicate routes, unsupported methods and wildcards', () => {
    const item = contract(definition, () => new Response())
    expect(() => toOpenApi({ info }, item, contract({ ...definition, path: '/other' }, () => new Response()))).toThrow(/operationId/)
    expect(() => toOpenApi({ info }, item, get('/items', () => new Response()))).toThrow(/duplicate route/)
    for (const changes of [{ method: 'CUSTOM' }, { method: 'patch' }, { path: '/files/*' }]) {
      const route = contract({ ...definition, ...changes }, () => new Response())
      expect(() => router(route)).not.toThrow()
      expect(() => toOpenApi({ info }, route)).toThrow(TypeError)
    }
  })

  it('checks parameter names and full patterns even without building a router first', () => {
    const item = contract({ ...definition, request: { params: { missing: { schema: textSchema } } } }, () => new Response())
    expect(() => toOpenApi({ info }, item)).toThrow(/missing/)
    expect(() => toOpenApi({ info }, group('/api/', contract(definition, () => new Response())))).toThrow(/empty segment/)
  })

  it.each([{ ...definition, responses: {} }, { ...definition, responses: { 600: { description: '' } } }, { ...definition, responses: { 200: {} } }, { ...definition, responses: { 200: { description: '', content: { invalid: { schema: textSchema } } } } }])('rejects invalid response declarations %j', (value) => {
    expect(() => contract(value as unknown as ContractDefinition, () => new Response())).toThrow(TypeError)
  })
})
