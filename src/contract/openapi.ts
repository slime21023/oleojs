import { checkMethod } from '../http-method.ts'
import { validateRoute } from '../routing/route.ts'
import type { RouteItem } from '../routing/route.ts'
import { Trie } from '../routing/trie.ts'
import { walkRoutes } from '../routing/walk.ts'
import { getContractDefinition } from './contract.ts'
import { requireRecord, requireText } from './definition.ts'
import { copyJson, embedSchema, pointerToken } from './json-schema.ts'
import type { StandardSchemaV1 } from './standard-schema.ts'
import type {
  ContractDefinition, JsonSchema, OpenApiDocument, OpenApiMethod, OpenApiOperation,
  OpenApiOptions, OpenApiParameter, OpenApiResponse, SecurityScheme,
} from './types.ts'

const METHODS = new Set(['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH', 'TRACE'])
const RESERVED_HEADERS = new Set(['accept', 'content-type', 'authorization'])

function checkSecuritySchemes(schemes: Readonly<Record<string, SecurityScheme>>): void {
  requireRecord(schemes, 'securitySchemes')
  for (const [name, scheme] of Object.entries(schemes)) {
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new TypeError(`Invalid security scheme name: ${name}`)
    requireRecord(scheme, 'security scheme')
    if (scheme.description !== undefined && typeof scheme.description !== 'string') throw new TypeError('Security description must be a string')
    switch (scheme.type) {
      case 'http':
        requireText(scheme.scheme, 'HTTP authentication scheme')
        if (scheme.bearerFormat !== undefined && (scheme.scheme.toLowerCase() !== 'bearer' || typeof scheme.bearerFormat !== 'string')) {
          throw new TypeError('bearerFormat requires a Bearer authentication scheme')
        }
        break
      case 'apiKey':
        requireText(scheme.name, 'API key name')
        if (!['query', 'header', 'cookie'].includes(scheme.in)) throw new TypeError('Invalid API key location')
        break
      case 'openIdConnect': requireText(scheme.openIdConnectUrl, 'openIdConnectUrl'); break
      case 'mutualTLS': break
      case 'oauth2':
        requireRecord(scheme.flows, 'OAuth flows')
        for (const [flowName, flow] of Object.entries(scheme.flows)) {
          if (!['implicit', 'password', 'clientCredentials', 'authorizationCode'].includes(flowName)) throw new TypeError('Invalid OAuth flow')
          requireRecord(flow, 'OAuth flow')
          if (flowName === 'implicit' || flowName === 'authorizationCode') requireText(flow.authorizationUrl, 'authorizationUrl')
          if (flowName !== 'implicit') requireText(flow.tokenUrl, 'tokenUrl')
          if (flow.refreshUrl !== undefined) requireText(flow.refreshUrl, 'refreshUrl')
          requireRecord(flow.scopes, 'OAuth scopes')
          if (Object.values(flow.scopes).some((description) => typeof description !== 'string')) throw new TypeError('Invalid OAuth scope description')
        }
        break
      default: throw new TypeError('Unsupported OpenAPI security scheme')
    }
  }
}

function problemResponse(status: 400 | 415 | 422): OpenApiResponse {
  const title = { 400: 'Bad Request', 415: 'Unsupported Media Type', 422: 'Unprocessable Content' }[status]
  const properties: Record<string, JsonSchema> = {
    type: { type: 'string', const: 'about:blank' }, title: { type: 'string', const: title }, status: { const: status },
  }
  const required = ['type', 'title', 'status']
  if (status === 422) {
    required.push('errors')
    properties.errors = {
      type: 'array', minItems: 1, items: {
        type: 'object', required: ['source', 'path', 'message'], properties: {
          source: { enum: ['params', 'query', 'headers', 'json'] },
          path: { type: 'array', items: { type: ['string', 'number'] } }, message: { type: 'string' },
        },
      },
    }
  }
  return { description: title, content: { 'application/problem+json': { schema: { type: 'object', required, properties } } } }
}

function operation(
  definition: ContractDefinition, segments: readonly string[], location: string, options: OpenApiOptions,
): OpenApiOperation {
  const convert = (schema: StandardSchemaV1, direction: 'input' | 'output', pointer: string): JsonSchema => {
    if (options.toJsonSchema !== undefined) return embedSchema(options.toJsonSchema(schema, direction), pointer)
    const converter = schema['~standard'].jsonSchema
    if (converter === undefined || typeof converter[direction] !== 'function') {
      throw new TypeError(`No JSON Schema exporter for ${definition.operationId}; supply toJsonSchema`)
    }
    return embedSchema(converter[direction]({ target: 'draft-2020-12' }), pointer)
  }
  const request = definition.request ?? {}
  const parameters: OpenApiParameter[] = []
  for (const segment of segments) {
    if (!segment.startsWith(':')) continue
    const name = segment.slice(1)
    const parameter = request.params !== undefined && Object.hasOwn(request.params, name) ? request.params[name] : undefined
    parameters.push({
      name, in: 'path', required: true, description: parameter?.description,
      schema: parameter === undefined ? { type: 'string' } : convert(parameter.schema, 'input', `${location}/parameters/${parameters.length}/schema`),
    })
  }
  for (const source of ['query', 'headers'] as const) {
    for (const [name, parameter] of Object.entries(request[source] ?? {})) {
      if (source === 'headers' && RESERVED_HEADERS.has(name.toLowerCase())) {
        throw new TypeError(`OpenAPI ignores header parameter ${name}; use content or security metadata instead`)
      }
      parameters.push({
        name, in: source === 'query' ? 'query' : 'header', required: parameter.required !== false,
        description: parameter.description,
        schema: convert(parameter.schema, 'input', `${location}/parameters/${parameters.length}/schema`),
      })
    }
  }
  const responses: Record<string, OpenApiResponse> = {}
  if (request.json !== undefined || parameters.some((parameter) => parameter.in === 'path')) responses['400'] = problemResponse(400)
  if (request.json !== undefined) responses['415'] = problemResponse(415)
  if (request.json !== undefined || [request.params, request.query, request.headers].some((fields) => fields !== undefined && Object.keys(fields).length > 0)) {
    responses['422'] = problemResponse(422)
  }
  for (const [status, response] of Object.entries(definition.responses)) {
    responses[status] = {
      description: response.description,
      ...(response.content === undefined ? {} : { content: Object.fromEntries(Object.entries(response.content).map(([media, value]) => [media, {
        schema: convert(value.schema, 'output', `${location}/responses/${status}/content/${pointerToken(media)}/schema`),
      }])) }),
    }
  }
  const securitySchemes = options.securitySchemes ?? {}
  for (const requirement of definition.security ?? []) {
    for (const name of Object.keys(requirement)) {
      if (!Object.hasOwn(securitySchemes, name)) throw new TypeError(`Unknown security scheme: ${name}`)
    }
  }
  return {
    operationId: definition.operationId,
    ...(definition.summary === undefined ? {} : { summary: definition.summary }),
    ...(parameters.length === 0 ? {} : { parameters }), responses,
    ...(request.json === undefined ? {} : { requestBody: { required: true, content: {
      'application/json': { schema: convert(request.json, 'input', `${location}/requestBody/content/application~1json/schema`) },
    } } }),
    ...(definition.security === undefined ? {} : { security: definition.security }),
  }
}

/**
 * Generate OpenAPI 3.1.1 from the same definitions passed to router(), without executing filters or handlers.
 * Ordinary routes are validated but omitted. Contract input errors receive default problem responses;
 * explicit responses take precedence. Unsupported methods, wildcard paths, and schema exports throw.
 */
export function toOpenApi<E = unknown>(options: OpenApiOptions, ...items: RouteItem<E, {}>[]): OpenApiDocument {
  requireRecord(options, 'OpenAPI options')
  requireRecord(options.info, 'OpenAPI info')
  requireText(options.info.title, 'API title')
  requireText(options.info.version, 'API version')
  if (options.info.description !== undefined && typeof options.info.description !== 'string') throw new TypeError('API description must be a string')
  if (options.toJsonSchema !== undefined && typeof options.toJsonSchema !== 'function') throw new TypeError('toJsonSchema must be a function')
  if (options.securitySchemes !== undefined) checkSecuritySchemes(options.securitySchemes)
  const paths: Record<string, Partial<Record<OpenApiMethod, OpenApiOperation>>> = {}
  const ids = new Set<string>()
  const trie = new Trie<true>()
  for (const { route, pattern } of walkRoutes<E>(items)) {
    checkMethod(route.method, pattern)
    const segments = trie.insert(route.method, pattern, true)
    validateRoute(route, segments)
    const definition = getContractDefinition(route)
    if (definition === undefined) continue
    if (!METHODS.has(route.method)) throw new TypeError(`OpenAPI cannot represent method ${route.method}`)
    if (segments.includes('*')) throw new TypeError(`OpenAPI cannot represent wildcard path ${pattern}`)
    if (ids.has(definition.operationId)) throw new TypeError(`Duplicate operationId: ${definition.operationId}`)
    ids.add(definition.operationId)
    const path = '/' + segments.map((segment) => segment.startsWith(':') ? `{${segment.slice(1)}}` : segment).join('/')
    const method = route.method.toLowerCase() as OpenApiMethod
    const pathItem = paths[path] ??= {}
    pathItem[method] = operation(definition, segments, `#/paths/${pointerToken(path)}/${method}`, options)
  }
  return copyJson({
    openapi: '3.1.1', info: options.info, paths,
    ...(options.securitySchemes === undefined ? {} : { components: { securitySchemes: options.securitySchemes } }),
  })
}
