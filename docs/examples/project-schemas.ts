import type { StandardResult, StandardSchemaV1 } from 'oleo.js/contract'

export interface Project { id: number; name: string }
export interface ProjectPage { items: Project[]; nextCursor: string | null }

// These application-owned validators make the example dependency-free. A compatible schema library can replace them.
function schema<I, O = I>(
  validate: (value: unknown) => StandardResult<O>,
  input: Record<string, unknown>, output: Record<string, unknown> = input,
): StandardSchemaV1<I, O> {
  return { '~standard': { version: 1, vendor: 'projects-example', validate, jsonSchema: { input: () => input, output: () => output } } }
}

function isProject(value: unknown): value is Project {
  return typeof value === 'object' && value !== null
    && 'id' in value && typeof value.id === 'number' && Number.isSafeInteger(value.id) && value.id > 0
    && 'name' in value && typeof value.name === 'string' && value.name.length > 0
}

const projectJsonSchema = {
  type: 'object', required: ['id', 'name'], properties: {
    id: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, name: { type: 'string', minLength: 1 },
  },
}

export const limitSchema = schema<string | undefined, number>((value) => {
  if (value === undefined) return { value: 20 }
  if (typeof value === 'string' && /^(?:[1-9][0-9]?|100)$/.test(value)) return { value: Number(value) }
  return { issues: [{ message: 'Limit must be between 1 and 100' }] }
}, { type: 'string', pattern: '^(?:[1-9][0-9]?|100)$', default: '20' }, { type: 'integer', minimum: 1, maximum: 100 })

export const cursorSchema = schema<string | undefined>((value) => {
  if (value === undefined || typeof value === 'string' && value.length > 0) return { value }
  return { issues: [{ message: 'Cursor must be nonempty' }] }
}, { type: 'string', minLength: 1 })

export const projectIdSchema = schema<string, number>((value) => {
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value))) return { value: Number(value) }
  return { issues: [{ message: 'Project ID must be a positive safe integer' }] }
}, { type: 'string', pattern: '^[1-9][0-9]*$', description: 'A positive integer within the JavaScript safe integer range' }, projectJsonSchema.properties.id)

export const createProjectSchema = schema<{ name: string }>((value) => {
  if (typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string' && value.name.length > 0) {
    return { value: { name: value.name } }
  }
  return { issues: [{ path: ['name'], message: 'Name is required' }] }
}, { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1 } } })

export const projectSchema = schema<Project>((value) => isProject(value)
  ? { value } : { issues: [{ message: 'Expected a project' }] }, projectJsonSchema)

export const projectPageSchema = schema<ProjectPage>((value) => {
  if (typeof value === 'object' && value !== null && 'items' in value && Array.isArray(value.items) && value.items.every(isProject)
    && 'nextCursor' in value && (value.nextCursor === null || typeof value.nextCursor === 'string')) {
    return { value: { items: value.items, nextCursor: value.nextCursor } }
  }
  return { issues: [{ message: 'Expected a project page' }] }
}, { type: 'object', required: ['items', 'nextCursor'], properties: { items: { type: 'array', items: projectJsonSchema }, nextCursor: { type: ['string', 'null'] } } })
