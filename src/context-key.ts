import type { Context } from './types.ts'

/** A typed context slot whose identity is independent of its diagnostic name. */
export interface ContextKey<T> {
  /** Label used in missing-value errors; keys with the same name remain independent. */
  readonly name: string
  /**
   * Read the stored value, including `undefined` if that value was explicitly stored.
   * @throws {TypeError} If the key is absent from the context.
   */
  get(ctx: Context): T
  /** Read the stored value, or return `undefined` when the key is absent. */
  find(ctx: Context): T | undefined
  /** Return a shallow copy with this key set, preserving existing fields and the context's type. */
  with<C extends Context>(ctx: C, value: T): C
}

/**
 * Create an immutable key for passing typed values through filters and handlers.
 * Share the returned key between writers and readers; creating another with the same name
 * creates a different slot. Stored values survive context derivation by the router.
 */
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
