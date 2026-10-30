import type { StandardResult, StandardSchemaV1 } from '../../../src/contract/index.ts'

export function schema<I = unknown, O = I>(
  validate: (value: unknown) => StandardResult<O> | Promise<StandardResult<O>>,
  input: Record<string, unknown> = {}, output: Record<string, unknown> = input,
): StandardSchemaV1<I, O> {
  return { '~standard': { version: 1, vendor: 'oleo-tests', validate, jsonSchema: { input: () => input, output: () => output } } }
}

export const textSchema = schema<string>((value) => typeof value === 'string' && value.length > 0
  ? { value } : { issues: [{ message: 'Expected nonempty text' }] }, { type: 'string', minLength: 1 })

export const idSchema = schema<string, number>((value) => {
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value))) return { value: Number(value) }
  return { issues: [{ message: 'Expected a positive integer' }] }
}, { type: 'string', pattern: '^[1-9][0-9]*$' }, { type: 'integer', minimum: 1 })

export const limitSchema = schema<string | undefined, number>((value) => {
  if (value === undefined) return { value: 20 }
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && Number(value) <= 100) return { value: Number(value) }
  return { issues: [{ message: 'Expected a limit between 1 and 100' }] }
}, { type: 'string', pattern: '^(?:[1-9][0-9]?|100)$', default: '20' }, { type: 'integer', minimum: 1, maximum: 100 })

export const cursorSchema = schema<string | undefined>((value) => value === undefined || typeof value === 'string' && value.length > 0
  ? { value } : { issues: [{ message: 'Expected a cursor' }] }, { type: 'string', minLength: 1 })

export const createSchema = schema<{ name: string }>((value) => {
  if (typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string' && value.name.length > 0) {
    return { value: { name: value.name } }
  }
  return { issues: [{ path: ['name'], message: 'Name is required' }] }
}, { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1 } } })

export const definition = { method: 'GET', path: '/items', operationId: 'items', responses: { 200: { description: 'Items' } } }
export const info = { title: 'Test API', version: '1' }
