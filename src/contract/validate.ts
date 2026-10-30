import { renderProblem } from '../http-problem.ts'
import type { Context } from '../types.ts'
import { isRecord } from './definition.ts'
import type { StandardSchemaV1 } from './standard-schema.ts'
import type { ContractIssue, ContractRequest } from './types.ts'

type Validation = { readonly input: Record<string, unknown>; readonly response?: undefined } | { readonly response: Response }

function issuePath(value: unknown): (string | number)[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new TypeError('Invalid Standard Schema issue path')
  return value.map((segment) => {
    const key = isRecord(segment) ? segment.key : segment
    if (typeof key === 'string' || (typeof key === 'number' && Number.isFinite(key))) return key
    if (typeof key === 'symbol') return String(key)
    throw new TypeError('Invalid Standard Schema issue path segment')
  })
}

async function validateValue(
  schema: StandardSchemaV1, value: unknown, source: keyof ContractRequest,
  path: readonly string[], errors: ContractIssue[],
): Promise<unknown> {
  const result: unknown = await schema['~standard'].validate(value)
  if (!isRecord(result)) throw new TypeError('Invalid Standard Schema result')
  if (result.issues === undefined) {
    if (!Object.hasOwn(result, 'value')) throw new TypeError('Standard Schema success must contain a value')
    return result.value
  }
  if (!Array.isArray(result.issues) || result.issues.length === 0) throw new TypeError('Standard Schema failure must contain issues')
  for (const issue of result.issues) {
    if (!isRecord(issue) || typeof issue.message !== 'string') throw new TypeError('Invalid Standard Schema issue')
    errors.push({ source, path: [...path, ...issuePath(issue.path)], message: issue.message })
  }
}

export async function validateInput(request: ContractRequest, req: Request, ctx: Context): Promise<Validation> {
  let json: unknown
  if (request.json !== undefined) {
    if (req.body === null) return { response: renderProblem({ status: 400 }, req.method) }
    const mediaType = req.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase()
    if (mediaType !== 'application/json') return { response: renderProblem({ status: 415 }, req.method) }
    // Keep stream errors outside the parse catch: a failed read is not invalid JSON.
    const text = await req.text()
    try {
      json = JSON.parse(text)
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      return { response: renderProblem({ status: 400 }, req.method) }
    }
  }
  const errors: ContractIssue[] = []
  const input: Record<string, unknown> = {}
  const query = request.query === undefined ? undefined : new URL(req.url).searchParams
  for (const source of ['params', 'query', 'headers'] as const) {
    const parameters = request[source]
    if (parameters === undefined) continue
    const fields: [string, unknown][] = []
    for (const [name, parameter] of Object.entries(parameters)) {
      let value: string | undefined
      if (source === 'params') value = Object.hasOwn(ctx.params, name) ? ctx.params[name] : undefined
      else if (source === 'headers') value = req.headers.get(name) ?? undefined
      else {
        const values = query!.getAll(name)
        if (values.length > 1) {
          errors.push({ source, path: [name], message: 'Expected a single value' })
          continue
        }
        value = values[0]
      }
      if (value === undefined && parameter.required !== false) {
        errors.push({ source, path: [name], message: 'Required value is missing' })
        continue
      }
      fields.push([name, await validateValue(parameter.schema, value, source, [name], errors)])
    }
    input[source] = Object.fromEntries(fields)
  }
  if (request.json !== undefined) input.json = await validateValue(request.json, json, 'json', [], errors)
  if (errors.length > 0) return { response: renderProblem({ status: 422, errors }, req.method) }
  return { input }
}
