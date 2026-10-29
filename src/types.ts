export type Params = Readonly<Record<string, string>>

type SegmentParams<TSegment extends string> =
  TSegment extends `:${infer Name}` ? { [K in Name]: string }
  : TSegment extends '*' ? { '*': string }
  : {}

type PatternParams<TPattern extends string> =
  TPattern extends `${infer Head}/${infer Rest}` ? SegmentParams<Head> & PatternParams<Rest>
  : SegmentParams<TPattern>

// `'/users/:id/*'` yields `{ readonly id: string; readonly '*': string }`.
export type ParamsOf<TPattern extends string> =
  string extends TPattern ? Params
  : { readonly [K in keyof PatternParams<TPattern> & string]: string }

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}

export interface Context<E = unknown, P extends Params = Params> {
  readonly params: P
  readonly env: E
  readonly executionCtx: ExecutionContext
}

export type HttpHandler<E = unknown, P extends Params = Params> =
  (req: Request, ctx: Context<E, P>) => Response | Promise<Response>

// A filter requiring env `E` applies to any handler whose env satisfies `E`.
export type HttpFilter<E = unknown> =
  <TEnv extends E, P extends Params>(next: HttpHandler<TEnv, P>) => HttpHandler<TEnv, P>

export interface FetchHandler<E = unknown> {
  fetch(request: Request, env?: E, executionCtx?: ExecutionContext): Promise<Response>
}
