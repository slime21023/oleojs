import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { compose } from '../../src/compose.ts'
import { contextKey } from '../../src/context-key.ts'
import { toFetch } from '../../src/fetch.ts'
import { get, router } from '../../src/index.ts'
import { EMPTY_PARAMS } from '../../src/context-defaults.ts'
import type { Context, HttpFilter } from '../../src/types.ts'
import { PROPERTY_OPTIONS } from './arbitraries.ts'

const ctx: Context = Object.freeze({ params: EMPTY_PARAMS, env: undefined, executionCtx: { waitUntil() {} } })

describe('contextKey', () => {
  it('keeps same-name keys independent across arbitrary context derivations', () => {
    fc.assert(fc.property(fc.string(), fc.jsonValue(), fc.jsonValue(), (name, first, second) => {
      const a = contextKey<unknown>(name)
      const b = contextKey<unknown>(name)
      const initial = a.with(ctx, first)
      const derived = b.with(initial, second)
      expect(a.get(derived)).toBe(first)
      expect(b.get(derived)).toBe(second)
      expect(b.find(initial)).toBeUndefined()
      expect(a.find(ctx)).toBeUndefined()
      expect(a.get({ ...derived, params: {} })).toBe(first)
    }), PROPERTY_OPTIONS)
  })

  it('derives a context without changing the original', () => {
    const userKey = contextKey<string>('user')
    const derived = userKey.with(ctx, 'alice')
    expect(derived).not.toBe(ctx)
    expect(userKey.get(derived)).toBe('alice')
    expect(userKey.find(ctx)).toBeUndefined()
    expect(derived.params).toBe(ctx.params)
  })

  it('throws a TypeError naming the key when the value is missing', () => {
    expect(() => contextKey('user').get(ctx)).toThrow(TypeError)
    expect(() => contextKey('user').get(ctx)).toThrow('Context value "user" is missing')
  })

  it('distinguishes a value set to undefined from a missing one', () => {
    const key = contextKey<string | undefined>('maybe')
    expect(key.get(key.with(ctx, undefined))).toBeUndefined()
  })

  it('keeps keys with the same name independent', () => {
    const a = contextKey<number>('id')
    const b = contextKey<number>('id')
    const derived = b.with(a.with(ctx, 1), 2)
    expect([a.get(derived), b.get(derived)]).toEqual([1, 2])
  })

  it('works when its methods are called detached', () => {
    const { get, with: set } = contextKey<string>('user')
    expect(get(set(ctx, 'alice'))).toBe('alice')
  })

  it('is frozen and exposes its name', () => {
    const key = contextKey('user')
    expect(key.name).toBe('user')
    expect(Object.isFrozen(key)).toBe(true)
  })
})

describe('end to end', () => {
  it('carries a filter-set value through the router to a handler with params', async () => {
    const userKey = contextKey<string>('user')
    const auth: HttpFilter = (next) => (req, ctx) => next(req, userKey.with(ctx, req.headers.get('X-User') ?? 'anon'))
    const app = toFetch(
      compose(auth)(
        router(get('/posts/:id', (req, ctx) => Response.json({ user: userKey.get(ctx), id: ctx.params.id }))),
      ),
    )
    const res = await app.fetch(new Request('http://example.test/posts/7', { headers: { 'X-User': 'alice' } }))
    expect(await res.json()).toEqual({ user: 'alice', id: '7' })
  })
})
