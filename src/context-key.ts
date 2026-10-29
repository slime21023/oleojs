import type { Context } from './types.ts'

export interface ContextKey<T> {
  readonly name: string
  // Throws a TypeError when no filter has set the value.
  get(ctx: Context): T
  find(ctx: Context): T | undefined
  // Returns a derived context; `ctx` is left unchanged.
  with<C extends Context>(ctx: C, value: T): C
}

export function contextKey<T>(name: string): ContextKey<T> {
  const symbol = Symbol(name)
  return Object.freeze({
    name,
    get(ctx: Context): T {
      if (!(symbol in ctx)) {
        throw new TypeError(`Context value "${name}" is missing; is the filter that sets it installed?`)
      }
      return (ctx as unknown as Record<symbol, T>)[symbol]
    },
    find(ctx: Context): T | undefined {
      return (ctx as unknown as Record<symbol, T | undefined>)[symbol]
    },
    with<C extends Context>(ctx: C, value: T): C {
      return { ...ctx, [symbol]: value }
    },
  })
}
