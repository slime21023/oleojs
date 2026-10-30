import { isRecord } from './definition.ts'
import type { JsonSchema } from './types.ts'

/** Copy JSON data without invoking toJSON hooks or sharing mutable containers with callers. */
export function copyJson<T>(value: T): T {
  const ancestors = new Set<object>()
  const copy = (item: unknown): unknown => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item
    if (typeof item === 'number' && Number.isFinite(item)) return item
    if (typeof item !== 'object' || item === null) throw new TypeError('Expected JSON-serializable data')
    if (ancestors.has(item)) throw new TypeError('Cyclic JSON data')
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
      throw new TypeError('Expected a plain JSON object')
    }
    ancestors.add(item)
    const result = Array.isArray(item)
      ? item.map(copy)
      : Object.fromEntries(Object.entries(item).filter(([, child]) => child !== undefined).map(([key, child]) => [key, copy(child)]))
    ancestors.delete(item)
    return result
  }
  // Copying preserves the JSON shape, omitting only optional undefined object properties.
  return copy(value) as T
}

export function pointerToken(value: string): string {
  return encodeURIComponent(value.replaceAll('~', '~0').replaceAll('/', '~1'))
}

const MAP_SCHEMAS = new Set(['$defs', 'definitions', 'properties', 'patternProperties', 'dependentSchemas'])
const ARRAY_SCHEMAS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])
const SINGLE_SCHEMAS = new Set([
  'additionalProperties', 'unevaluatedProperties', 'propertyNames', 'contains', 'items',
  'unevaluatedItems', 'not', 'if', 'then', 'else', 'contentSchema',
])

/** Rebase references in an anonymous schema resource when embedding it into an OpenAPI document. */
export function embedSchema(schema: JsonSchema, destination: string): JsonSchema {
  if (typeof schema !== 'boolean' && !isRecord(schema)) throw new TypeError('Schema export must return an object or boolean')
  const result = copyJson(schema)
  const nodes: { value: Record<string, unknown>; pointer: string }[] = []
  const anchors = new Map<string, string>()
  const visit = (value: unknown, pointer: string): void => {
    if (typeof value === 'boolean') return
    if (!isRecord(value)) throw new TypeError('Invalid JSON Schema subschema')
    // An explicit ID starts a resource whose references must keep their original resolution scope.
    if (value.$id !== undefined) {
      if (typeof value.$id !== 'string') throw new TypeError('JSON Schema $id must be a string')
      return
    }
    if (value.$dynamicRef !== undefined || value.$dynamicAnchor !== undefined) {
      throw new TypeError('Dynamic schema references require an explicit resource $id')
    }
    nodes.push({ value, pointer })
    if (value.$anchor !== undefined) {
      if (typeof value.$anchor !== 'string' || !/^[A-Za-z_][-A-Za-z0-9._]*$/.test(value.$anchor) || anchors.has(value.$anchor)) {
        throw new TypeError('Invalid or duplicate JSON Schema anchor')
      }
      anchors.set(value.$anchor, pointer)
    }
    for (const [key, child] of Object.entries(value)) {
      const location = `${pointer}/${pointerToken(key)}`
      if (MAP_SCHEMAS.has(key)) {
        if (!isRecord(child)) throw new TypeError(`JSON Schema ${key} must be an object`)
        for (const [name, nested] of Object.entries(child)) visit(nested, `${location}/${pointerToken(name)}`)
      } else if (ARRAY_SCHEMAS.has(key)) {
        if (!Array.isArray(child)) throw new TypeError(`JSON Schema ${key} must be an array`)
        child.forEach((nested, index) => visit(nested, `${location}/${index}`))
      } else if (SINGLE_SCHEMAS.has(key)) visit(child, location)
    }
  }
  visit(result, destination)
  for (const { value } of nodes) {
    const ref = value.$ref
    if (ref !== undefined && typeof ref !== 'string') throw new TypeError('JSON Schema $ref must be a string')
    if (typeof ref === 'string' && (ref === '' || ref.startsWith('#'))) {
      const fragment = decodeURIComponent(ref.slice(1))
      if (fragment === '' || fragment.startsWith('/')) value.$ref = destination + ref.slice(1)
      else {
        const target = anchors.get(fragment)
        if (target === undefined) throw new TypeError(`Unknown local schema anchor: ${fragment}`)
        value.$ref = target
      }
    }
    // Anonymous resources share the document's scope; pointers replace their otherwise colliding anchors.
    delete value.$anchor
  }
  return result
}
