import type { ContractDefinition, ContractParameter, ContractRequest, ContractResponse } from './types.ts'
import type { StandardSchemaV1 } from './standard-schema.ts'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function requireRecord(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${name} must be an object`)
}

export function requireText(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a nonempty string`)
}

function checkSchema(schema: unknown): asserts schema is StandardSchemaV1 {
  if ((!isRecord(schema) && typeof schema !== 'function') || !('~standard' in schema)) {
    throw new TypeError('Expected a Standard Schema validator')
  }
  const props = schema['~standard']
  if (!isRecord(props) || props.version !== 1 || typeof props.vendor !== 'string' || typeof props.validate !== 'function') {
    throw new TypeError('Expected Standard Schema v1 with a validate function')
  }
}

function snapshotParameters(value: unknown, source: 'params' | 'query' | 'headers'): Readonly<Record<string, ContractParameter>> {
  requireRecord(value, source)
  const names = new Set<string>()
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([name, parameter]) => {
    requireText(name, 'Parameter name')
    requireRecord(parameter, `Parameter ${name}`)
    checkSchema(parameter.schema)
    if (parameter.required !== undefined && typeof parameter.required !== 'boolean') throw new TypeError('required must be boolean')
    if (parameter.description !== undefined && typeof parameter.description !== 'string') throw new TypeError('description must be a string')
    if (source === 'params' && parameter.required === false) throw new TypeError('Path parameters must be required')
    if (source === 'headers') {
      new Headers([[name, '']])
      const lower = name.toLowerCase()
      if (names.has(lower)) throw new TypeError(`Duplicate header parameter: ${name}`)
      names.add(lower)
    }
    return [name, Object.freeze({ schema: parameter.schema, required: parameter.required !== false, description: parameter.description })]
  })))
}

/** Copy declaration containers; schema instances remain application-owned, opaque objects. */
export function snapshotDefinition<P extends string>(definition: ContractDefinition<P>): ContractDefinition<P> {
  requireRecord(definition, 'Contract definition')
  requireText(definition.operationId, 'operationId')
  if (definition.summary !== undefined && typeof definition.summary !== 'string') throw new TypeError('summary must be a string')
  const request: { -readonly [K in keyof ContractRequest]: ContractRequest[K] } = {}
  if (definition.request !== undefined) {
    requireRecord(definition.request, 'request')
    for (const key of Object.keys(definition.request)) {
      if (!['params', 'query', 'headers', 'json'].includes(key)) throw new TypeError(`Unsupported request source: ${key}`)
    }
    for (const source of ['params', 'query', 'headers'] as const) {
      const parameters = definition.request[source]
      if (parameters !== undefined) request[source] = snapshotParameters(parameters, source)
    }
    if (definition.request.json !== undefined) {
      checkSchema(definition.request.json)
      request.json = definition.request.json
    }
  }
  requireRecord(definition.responses, 'responses')
  if (Object.keys(definition.responses).length === 0) throw new TypeError('At least one response is required')
  const responses = Object.fromEntries(Object.entries(definition.responses).map(([status, response]) => {
    if (status !== 'default' && !/^[1-5][0-9]{2}$/.test(status)) throw new TypeError(`Invalid response status: ${status}`)
    requireRecord(response, 'response')
    if (typeof response.description !== 'string') throw new TypeError('Response description must be a string')
    let content: ContractResponse['content']
    if (response.content !== undefined) {
      requireRecord(response.content, 'response content')
      content = Object.freeze(Object.fromEntries(Object.entries(response.content).map(([mediaType, media]) => {
        requireText(mediaType, 'Media type')
        if (!/^[^\s/;]+\/[^\s/;]+(?:\s*;.*)?$/.test(mediaType)) throw new TypeError(`Invalid media type: ${mediaType}`)
        requireRecord(media, 'media')
        checkSchema(media.schema)
        return [mediaType, Object.freeze({ schema: media.schema })]
      })))
    }
    return [status, Object.freeze({ description: response.description, ...(content === undefined ? {} : { content }) })]
  }))
  if (definition.security !== undefined && !Array.isArray(definition.security)) throw new TypeError('security must be an array')
  const security = definition.security?.map((requirement) => {
    requireRecord(requirement, 'security requirement')
    return Object.freeze(Object.fromEntries(Object.entries(requirement).map(([name, values]) => {
      requireText(name, 'Security scheme name')
      if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) throw new TypeError('Security requirement values must be strings')
      return [name, Object.freeze([...values])]
    })))
  })
  return Object.freeze({
    method: definition.method, path: definition.path, operationId: definition.operationId,
    summary: definition.summary, request: Object.freeze(request), responses: Object.freeze(responses),
    ...(security === undefined ? {} : { security: Object.freeze(security) }),
  })
}
