/** Decoded route parameters, including a terminal wildcard under the `'*'` key. */
export type Params = Readonly<Record<string, string>>

type SegmentParams<TSegment extends string> =
  TSegment extends `:${infer Name}` ? { [K in Name]: string }
  : TSegment extends '*' ? { '*': string }
  : {}

type PatternParams<TPattern extends string> =
  TPattern extends `${infer Head}/${infer Rest}` ? SegmentParams<Head> & PatternParams<Rest>
  : SegmentParams<TPattern>

/**
 * Infer parameter names from a literal route pattern; a general `string` yields {@link Params}.
 * For example, `ParamsOf<'/users/:id/*'>` has readonly `id` and `'*'` string properties.
 */
export type ParamsOf<TPattern extends string> =
  string extends TPattern ? Params
  : { readonly [K in keyof PatternParams<TPattern> & string]: string }

// A conditional type would widen unresolved group parameters to Params during inference.
export type JoinParams<A extends Params, B extends Params> =
  { readonly [K in (keyof A | keyof B) & string]: string }

/** Background-task support modeled on Workers; this is an oleojs interface. */
export interface ExecutionContext {
  /** Register background work; extending the request lifetime depends on the host. */
  waitUntil(promise: Promise<unknown>): void
}

/** Request data passed through handlers and filters; add values by deriving a new context. */
export interface Context<E = unknown, P extends Params = Params> {
  /** Decoded route parameters; empty at the Fetch entry point. */
  readonly params: P
  /** Runtime or caller data. An omitted environment remains `undefined` at runtime. */
  readonly env: E
  /** Host background-task support, or a fallback that only reports rejected promises. */
  readonly executionCtx: ExecutionContext
}

/** Handle a native Web request with typed environment data and route parameters. */
export type HttpHandler<E = unknown, P extends Params = Params> =
  (req: Request, ctx: Context<E, P>) => Response | Promise<Response>

// Generic constraints alone allow incompatible environments; this type-only marker rejects them.
declare const FILTER_ENV: unique symbol

/**
 * Middleware requiring environment `E`, while preserving the wrapped handler's parameter types.
 * It can wrap any handler whose environment satisfies `E`, including a more specific environment.
 */
export type HttpFilter<E = unknown> =
  (<TEnv extends E, P extends Params>(next: HttpHandler<TEnv, P>) => HttpHandler<TEnv, P>)
  & { readonly [FILTER_ENV]?: (env: E) => void }

/**
 * Arguments after the request: `env` may be omitted only when `undefined` is a valid environment.
 * The check is deliberately non-distributive, so `unknown` and `Env | undefined` keep it optional.
 */
export type FetchArgs<E> = undefined extends E
  ? [env?: E, executionCtx?: ExecutionContext]
  : [env: E, executionCtx?: ExecutionContext]

/** A Fetch entry point following the Workers call shape, usable by runtimes and adapters. */
export interface FetchHandler<E = unknown> {
  /**
   * Handle a request; `toFetch` creates a context from these arguments and always returns a promise.
   * A handler that needs an environment requires one, so a direct call cannot omit it by accident.
   */
  fetch(request: Request, ...args: FetchArgs<E>): Promise<Response>
}
