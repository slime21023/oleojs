import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { compose, withFilters } from '../../src/compose.ts'
import { EMPTY_PARAMS } from '../../src/context-defaults.ts'
import type { Context, HttpFilter, HttpHandler } from '../../src/types.ts'
import { PROPERTY_OPTIONS } from './arbitraries.ts'

const ctx: Context = { params: EMPTY_PARAMS, env: undefined, executionCtx: { waitUntil() {} } }
const request = () => new Request('http://example.test/')

function tracing(name: string, log: string[]): HttpFilter {
  return (next) => async (req, ctx) => {
    log.push(`${name} in`)
    const res = await next(req, ctx)
    log.push(`${name} out`)
    return res
  }
}

describe('compose', () => {
  it.each(['compose', 'withFilters'])('%s enters any filter sequence in order and exits in reverse', async (entry) => {
    await fc.assert(fc.asyncProperty(fc.array(fc.string(), { maxLength: 12 }), async (names) => {
      const log: string[] = []
      const filters = names.map((name) => tracing(name, log))
      const next = () => new Response()
      const app = entry === 'compose' ? compose(...filters)(next) : withFilters(next, ...filters)
      await app(request(), ctx)
      expect(log).toEqual([
        ...names.map((name) => `${name} in`),
        ...names.toReversed().map((name) => `${name} out`),
      ])
    }), PROPERTY_OPTIONS)
  })

  it('makes the first filter outermost', async () => {
    const log: string[] = []
    const handler: HttpHandler = () => (log.push('handler'), new Response())
    await compose(tracing('a', log), tracing('b', log))(handler)(request(), ctx)
    expect(log).toEqual(['a in', 'b in', 'handler', 'b out', 'a out'])
  })

  it('is the identity with no filters', () => {
    const handler: HttpHandler = () => new Response()
    expect(compose()(handler)).toBe(handler)
  })

  it('applies filters once, not per request', async () => {
    let applications = 0
    const counting: HttpFilter = (next) => {
      applications++
      return next
    }
    const app = compose(counting, counting)(() => new Response())
    await app(request(), ctx)
    await app(request(), ctx)
    expect(applications).toBe(2)
  })

  it('lets a filter short-circuit', async () => {
    const deny: HttpFilter = () => () => new Response(null, { status: 403 })
    const res = await compose(deny)(() => new Response())(request(), ctx)
    expect(res.status).toBe(403)
  })
})

describe('withFilters', () => {
  it('returns the handler unchanged when no filters are supplied', () => {
    const handler: HttpHandler = () => new Response()
    expect(withFilters(handler)).toBe(handler)
  })

  it('wraps once and supports short-circuiting on each request', async () => {
    let wraps = 0
    let requests = 0
    const deny: HttpFilter = () => {
      wraps++
      return () => { requests++; return new Response(null, { status: 403 }) }
    }
    const app = withFilters(() => { throw new Error('must not run') }, deny)
    expect((await app(request(), ctx)).status).toBe(403)
    expect((await app(request(), ctx)).status).toBe(403)
    expect(wraps).toBe(1)
    expect(requests).toBe(2)
  })
})
