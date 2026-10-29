import { describe, expectTypeOf, it } from 'vitest'
import { bearerAuth, cors, problemDetails, requestLogger } from '../../src/filters/index.ts'
import type { BearerAuthOptions, CorsOptions, LogEntry, Problem, ProblemDetailsOptions, RequestLoggerOptions } from '../../src/filters/index.ts'
import { compose, contextKey, get, group, router } from '../../src/index.ts'
import type { Context, HttpFilter, HttpHandler, ParamsOf } from '../../src/types.ts'

interface Env { DB: string }

describe('problemDetails types', () => {
  it('returns an environment-agnostic filter that preserves handler parameters', () => {
    expectTypeOf(problemDetails()).toEqualTypeOf<HttpFilter>()
    const handler: HttpHandler<Env, ParamsOf<'/users/:id'>> = () => new Response()
    expectTypeOf(problemDetails()(handler)).toEqualTypeOf<typeof handler>()
  })

  it('preserves contextual inference around routes and inside groups', () => {
    router<Env>(
      get('/users/:id', problemDetails()((_req, ctx) => {
        expectTypeOf(ctx.env).toEqualTypeOf<Env>()
        expectTypeOf(ctx.params).toEqualTypeOf<{ readonly id: string }>()
        return new Response()
      })),
      group('/teams/:team', { filters: [problemDetails()] }, get('/users/:id', (_req, ctx) => {
        expectTypeOf(ctx.env).toEqualTypeOf<Env>()
        expectTypeOf(ctx.params).toEqualTypeOf<{ readonly team: string; readonly id: string }>()
        return new Response()
      })),
    )
  })

  it('composes with an environment-requiring filter without weakening its requirement', () => {
    const needsDb: HttpFilter<Env> = (next) => (req, ctx) => next(req, ctx)
    const handler: HttpHandler<Env> = () => new Response()
    expectTypeOf(compose(problemDetails(), needsDb)(handler)).toEqualTypeOf<typeof handler>()
    const incompatible: HttpHandler<{ KV: string }> = () => new Response()
    // @ts-expect-error -- needsDb still requires Env through the composition
    compose(problemDetails(), needsDb)(incompatible)
  })

  it('types callback inputs and permits application-specific problem fields', () => {
    const options: ProblemDetailsOptions = {
      fromError(error, req) {
        expectTypeOf(error).toEqualTypeOf<unknown>()
        expectTypeOf(req).toEqualTypeOf<Request>()
        return { status: 422, detail: 'Invalid input', errors: [{ field: 'name' }] }
      },
      onError(error, req) {
        expectTypeOf(error).toEqualTypeOf<unknown>()
        expectTypeOf(req).toEqualTypeOf<Request>()
      },
      emptyResponses: false,
    }
    problemDetails(options)
    const problem: Problem = { status: 400, code: 'invalid' }
    expectTypeOf(problem.code).toEqualTypeOf<unknown>()
    // @ts-expect-error -- problem fields are read-only
    problem.status = 500
  })

  it('rejects incompatible options and asynchronous error mapping', () => {
    // @ts-expect-error -- status must be a number
    problemDetails({ fromError: () => ({ status: '400' }) })
    // @ts-expect-error -- mapping must be synchronous
    problemDetails({ fromError: async () => ({ status: 400 }) })
    // @ts-expect-error -- callbacks must accept any thrown value
    problemDetails({ fromError: (_error: Error) => ({ status: 400 }) })
    // @ts-expect-error -- emptyResponses is a boolean
    problemDetails({ emptyResponses: 'yes' })
    // @ts-expect-error -- onError is a callback
    problemDetails({ onError: true })
  })
})

describe('CORS and request logger types', () => {
  it('preserves environment and parameters when wrapping a typed handler', () => {
    expectTypeOf(cors({ origin: '*' })).toEqualTypeOf<HttpFilter>()
    expectTypeOf(requestLogger()).toEqualTypeOf<HttpFilter>()
    const handler: HttpHandler<Env, ParamsOf<'/users/:id'>> = () => new Response()
    expectTypeOf(cors({ origin: '*' })(handler)).toEqualTypeOf<typeof handler>()
    expectTypeOf(requestLogger()(handler)).toEqualTypeOf<typeof handler>()
    expectTypeOf(compose(requestLogger(), cors({ origin: '*' }), problemDetails())(handler)).toEqualTypeOf<typeof handler>()
  })

  it('preserves contextual environment and group parameters', () => {
    router<Env>(group('/teams/:team', { filters: [requestLogger()] }, get('/users/:id', (_req, ctx) => {
      expectTypeOf(ctx.env).toEqualTypeOf<Env>()
      expectTypeOf(ctx.params).toEqualTypeOf<{ readonly team: string; readonly id: string }>()
      return new Response()
    })))
  })

  it('types origin predicates, immutable lists, and log callbacks', () => {
    const options: CorsOptions = {
      origin(origin, req) {
        expectTypeOf(origin).toEqualTypeOf<string>()
        expectTypeOf(req).toEqualTypeOf<Request>()
        return true
      },
      methods: ['GET'] as const,
      allowHeaders: ['Authorization'] as const,
      exposeHeaders: ['X-Count'] as const,
    }
    cors(options)
    const logging: RequestLoggerOptions = {
      fields(req, response) {
        expectTypeOf(req).toEqualTypeOf<Request>()
        expectTypeOf(response).toEqualTypeOf<Response | undefined>()
        return { trace: 'abc' }
      },
      log(entry) {
        expectTypeOf(entry).toEqualTypeOf<LogEntry>()
        expectTypeOf(entry.status).toEqualTypeOf<number | undefined>()
        expectTypeOf(entry.error).toEqualTypeOf<true | undefined>()
        // @ts-expect-error -- log entries are read-only
        entry.path = '/changed'
      },
    }
    requestLogger(logging)
  })

  it('rejects missing origins and incompatible option values', () => {
    // @ts-expect-error -- origin is required
    cors({})
    // @ts-expect-error -- origin predicates are synchronous
    cors({ origin: async () => true })
    // @ts-expect-error -- methods are an array
    cors({ origin: '*', methods: 'GET' })
    // @ts-expect-error -- maxAge is numeric
    cors({ origin: '*', maxAge: '60' })
    // @ts-expect-error -- fields must return a record synchronously
    requestLogger({ fields: async () => ({ trace: 'abc' }) })
    // @ts-expect-error -- logging receives a LogEntry
    requestLogger({ log: (_entry: string) => {} })
  })
})

describe('bearerAuth types', () => {
  interface User { id: string }
  const userKey = contextKey<User>('user')

  it('infers the environment from an annotated verifier and preserves handler params', () => {
    const filter = bearerAuth({
      verify: async (_token, _req, ctx: Context<Env>) => ({ id: ctx.env.DB }),
      key: userKey,
    })
    expectTypeOf(filter).toEqualTypeOf<HttpFilter<Env>>()
    const handler: HttpHandler<Env, ParamsOf<'/users/:id'>> = () => new Response()
    expectTypeOf(filter(handler)).toEqualTypeOf<typeof handler>()
    const incompatible: HttpHandler<{ KV: string }> = () => new Response()
    // @ts-expect-error -- verification still requires Env
    filter(incompatible)
  })

  it('infers callback environment from router and group context', () => {
    router<Env>(group('/users/:id', {
      filters: [bearerAuth({
        verify(token, req, ctx) {
          expectTypeOf(token).toEqualTypeOf<string>()
          expectTypeOf(req).toEqualTypeOf<Request>()
          expectTypeOf(ctx.env).toEqualTypeOf<Env>()
          return { id: ctx.env.DB }
        },
        key: userKey,
      })],
    }, get('', (_req, ctx) => {
      expectTypeOf(ctx.params).toEqualTypeOf<{ readonly id: string }>()
      expectTypeOf(userKey.get(ctx)).toEqualTypeOf<User>()
      return new Response()
    })))
  })

  it('accepts explicit option types and verification without a key', () => {
    const options: BearerAuthOptions<Env, User> = { verify: (_token, _req, ctx) => ({ id: ctx.env.DB }), key: userKey }
    expectTypeOf(bearerAuth(options)).toEqualTypeOf<HttpFilter<Env>>()
    expectTypeOf(bearerAuth({ verify: () => false })).toEqualTypeOf<HttpFilter>()
    bearerAuth({ verify: async () => null, key: contextKey<null>('principal') })
  })

  it('rejects incompatible principals and missing verification', () => {
    // @ts-expect-error -- a verifier is required
    bearerAuth({ key: userKey })
    // @ts-expect-error -- the verifier does not produce a User
    bearerAuth({ verify: () => 'wrong principal', key: userKey })
    const unknownPrincipal: unknown = {}
    // @ts-expect-error -- unknown values must be narrowed before being stored in a User key
    bearerAuth({ verify: () => unknownPrincipal, key: userKey })
    // @ts-expect-error -- realm must be a string
    bearerAuth({ verify: () => true, realm: 42 })
  })
})
