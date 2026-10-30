import { describe, expectTypeOf, it } from 'vitest'
import { contextKey, group, router, toFetch, withFilters } from '../../src/index.ts'
import type { Context, HttpFilter, Route, RouteGroup } from '../../src/index.ts'
import { bearerAuth } from '../../src/filters/index.ts'
import { contract, toOpenApi } from '../../src/contract/index.ts'
import type { ContractInput, ContractRequest, OpenApiDocument, StandardSchemaV1 } from '../../src/contract/index.ts'
import { createSchema, cursorSchema, definition, idSchema, info, limitSchema, schema } from '../portable/contract/fixtures.ts'

interface Env { db: string }

describe('Contract inference', () => {
  it('infers validated outputs while retaining contextual environments and raw parameters', () => {
    router<Env>(group('/teams/:team', contract({
      ...definition, path: '/items/:id', request: {
        params: { id: { schema: idSchema } },
        query: { limit: { schema: limitSchema, required: false }, cursor: { schema: cursorSchema, required: false } },
      },
    }, (_req, ctx, input) => {
      expectTypeOf(ctx.env).toEqualTypeOf<Env>()
      expectTypeOf(ctx.params).toEqualTypeOf<{ readonly team: string; readonly id: string }>()
      expectTypeOf(input.params.id).toEqualTypeOf<number>()
      expectTypeOf(input.query.limit).toEqualTypeOf<number>()
      expectTypeOf(input.query.cursor).toEqualTypeOf<string | undefined>()
      // @ts-expect-error -- undeclared sources are not present.
      void input.json
      // @ts-expect-error -- undeclared fields are not present.
      void input.query.sort
      return new Response(ctx.env.db)
    })))
  })

  it('supports separately declared routes and preserves body outputs', () => {
    const item: Route<Env> = contract({ ...definition, method: 'POST', request: { json: createSchema } }, (_req, ctx, { json }) => {
      expectTypeOf(ctx.env).toEqualTypeOf<Env>()
      expectTypeOf(json).toEqualTypeOf<{ name: string }>()
      return Response.json(json, { status: 201 })
    })
    const app = toFetch(router(item))
    // @ts-expect-error -- supplied env must satisfy the route.
    app.fetch(new Request('https://test/'), {})
    expectTypeOf(toOpenApi({ info }, item)).toEqualTypeOf<OpenApiDocument>()
  })

  it('keeps group authentication and principal inference', () => {
    const key = contextKey<{ id: string }>('user')
    const items: RouteGroup<Env> = group('', { filters: [bearerAuth({ key, verify: (_token, _req, ctx) => {
      expectTypeOf(ctx.env).toEqualTypeOf<Env>()
      return { id: ctx.env.db }
    } })] }, contract(definition, (_req, ctx, input) => {
      expectTypeOf(ctx.env).toEqualTypeOf<Env>()
      expectTypeOf(input).toEqualTypeOf<{}>()
      expectTypeOf(key.get(ctx)).toEqualTypeOf<{ id: string }>()
      return new Response()
    }))
    expectTypeOf(items).toEqualTypeOf<RouteGroup<Env>>()
  })

  it('allows schema definitions to be reused without widening their output', () => {
    const request = { json: createSchema, query: { limit: { schema: limitSchema, required: false } } }
    type Input = ContractInput<typeof request>
    expectTypeOf<Input['json']>().toEqualTypeOf<{ name: string }>()
    expectTypeOf<Input['query']['limit']>().toEqualTypeOf<number>()
    contract({ ...definition, request }, (_req, _ctx, input) => {
      expectTypeOf(input).toEqualTypeOf<Input>()
      return new Response()
    })
  })

  it('keeps broadly annotated request outputs unknown until narrowed', () => {
    expectTypeOf<ContractInput<ContractRequest>>().toEqualTypeOf<{
      readonly params?: Readonly<Record<string, unknown>>
      readonly query?: Readonly<Record<string, unknown>>
      readonly headers?: Readonly<Record<string, unknown>>
      readonly json?: unknown
    }>()
    const request: ContractRequest = { json: schema<unknown, null>(() => ({ value: null })) }
    contract({ ...definition, method: 'POST', request }, (_req, _ctx, input) => {
      expectTypeOf(input.json).toEqualTypeOf<unknown>()
      if (input.json !== undefined) {
        // @ts-expect-error -- removing undefined does not rule out null or establish a value type.
        void input.json.toString()
      }
      return new Response()
    })
  })

  it('retains nullable outputs for optional JSON sources', () => {
    const nullable = schema<unknown, { name: string } | null>(() => ({ value: null }))
    const request: { readonly json?: typeof nullable } = { json: nullable }
    type Input = ContractInput<typeof request>
    expectTypeOf<Input>().toEqualTypeOf<{ readonly json?: { name: string } | null }>()
    contract({ ...definition, request }, (_req, _ctx, input) => {
      expectTypeOf(input.json).toEqualTypeOf<{ name: string } | null | undefined>()
      return new Response()
    })
  })

  it('preserves optional parameter sources and fields without adding undefined to defaults', () => {
    type Request = {
      readonly query?: {
        readonly limit: { schema: typeof limitSchema; required: false }
        readonly cursor?: { schema: typeof cursorSchema; required: false }
      }
      readonly headers?: { readonly 'x-id': { schema: typeof idSchema } }
      readonly params?: { readonly id: { schema: typeof idSchema } }
    }
    expectTypeOf<ContractInput<Request>>().toEqualTypeOf<{
      readonly query?: { readonly limit: number; readonly cursor?: string | undefined }
      readonly headers?: { readonly 'x-id': number }
      readonly params?: { readonly id: number }
    }>()
    type UnionRequest = { query: Request['query']; json: typeof createSchema | StandardSchemaV1<unknown, null> | undefined }
    expectTypeOf<ContractInput<UnionRequest>>().toEqualTypeOf<{
      readonly query: { readonly limit: number; readonly cursor?: string | undefined } | undefined
      readonly json: { name: string } | null | undefined
    }>()
  })

  it('preserves concrete schema outputs when a reusable declaration satisfies ContractRequest', () => {
    const request = {
      json: schema<unknown, null>(() => ({ value: null })),
      query: { limit: { schema: limitSchema, required: false } },
    } satisfies ContractRequest
    contract({ ...definition, request }, (_req, _ctx, input) => {
      expectTypeOf(input).toEqualTypeOf<{ readonly json: null; readonly query: { readonly limit: number } }>()
      // @ts-expect-error -- validated sources are readonly.
      input.json = null
      // @ts-expect-error -- validated fields are readonly.
      input.query.limit = 1
      return new Response()
    })
  })

  it('does not infer a wider schema from an incompatible handler', () => {
    contract({ ...definition, request: { json: createSchema } },
      // @ts-expect-error -- the schema produces a name, not an id.
      (_req, _ctx, _input: { json: { id: number } }) => new Response())
  })

  it('preserves a separately typed handler requiring an enclosing group parameter', () => {
    const handler = (_req: Request, ctx: Context<Env, { readonly team: string; readonly id: string }>) => new Response(ctx.params.team)
    router<Env>(group('/teams/:team', contract({ ...definition, path: '/items/:id' }, handler)))
    // @ts-expect-error -- no group supplies team here.
    router<Env>(contract({ ...definition, path: '/items/:id' }, handler))
  })

  it('retains intersected filter environments at the fetch boundary', () => {
    const cache: HttpFilter<{ cache: string }> = (next) => next
    const item: Route<Env> = contract(definition, (_req, ctx) => new Response(ctx.env.db))
    const app = toFetch(withFilters(router(item), cache))
    app.fetch(new Request('https://test/'), { db: '', cache: '' })
    // @ts-expect-error -- cache is required by the filter.
    app.fetch(new Request('https://test/'), { db: '' })
  })

  it('accepts structurally compatible async schemas and undefined outputs', () => {
    const optional: StandardSchemaV1<unknown, undefined> = { '~standard': {
      version: 1, vendor: 'test', validate: async () => ({ value: undefined }),
    } }
    contract({ ...definition, request: { headers: { 'x-value': { schema: optional, required: false } } } }, (_req, _ctx, input) => {
      expectTypeOf(input.headers['x-value']).toEqualTypeOf<undefined>()
      return new Response()
    })
  })

  it('keeps native Responses independent of response documentation', () => {
    contract({ ...definition, responses: { 200: { description: 'Documented JSON', content: { 'application/json': { schema: createSchema } } } } },
      () => new Response('A native response remains valid', { status: 202 }))
  })
})
