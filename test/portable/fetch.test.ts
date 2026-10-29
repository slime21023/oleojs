import { describe, expect, it, vi } from 'vitest'
import { STUB_EXECUTION_CTX, toFetch } from '../../src/fetch.ts'
import { EMPTY_PARAMS } from '../../src/trie.ts'
import type { Context, ExecutionContext } from '../../src/types.ts'

const request = () => new Request('http://example.test/')

describe('toFetch', () => {
  it('creates a fresh context per request from the runtime arguments', async () => {
    const seen: Context<{ DB: string }>[] = []
    const { fetch } = toFetch<{ DB: string }>((req, ctx) => (seen.push(ctx), new Response()))
    const executionCtx: ExecutionContext = { waitUntil() {} }
    await fetch(request(), { DB: 'db' }, executionCtx)
    await fetch(request(), { DB: 'db' }, executionCtx)
    expect(seen[0]).toEqual({ params: EMPTY_PARAMS, env: { DB: 'db' }, executionCtx })
    expect(seen[0]!.params).toBe(EMPTY_PARAMS)
    expect(seen[0]).not.toBe(seen[1])
  })

  it('works in memory with env and executionCtx omitted', async () => {
    let seen: Context | undefined
    const res = await toFetch((req, ctx) => ((seen = ctx), new Response('ok'))).fetch(request())
    expect(await res.text()).toBe('ok')
    expect(seen?.env).toBeUndefined()
    expect(seen?.executionCtx).toBe(STUB_EXECUTION_CTX)
  })

  it('works when called detached', async () => {
    const { fetch } = toFetch(() => new Response('ok'))
    const detached = fetch
    expect(await (await detached(request())).text()).toBe('ok')
  })

  it('always returns a promise, rejecting on synchronous throws', async () => {
    const result = toFetch(() => new Response()).fetch(request())
    expect(result).toBeInstanceOf(Promise)
    const failing = toFetch(() => {
      throw new Error('boom')
    })
    await expect(failing.fetch(request())).rejects.toThrow('boom')
  })
})

describe('executionCtx stub', () => {
  it('reports rejections instead of leaving them unhandled', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('background failure')
    STUB_EXECUTION_CTX.waitUntil(Promise.reject(error))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(report).toHaveBeenCalledWith(error)
    report.mockRestore()
  })

  it('is frozen', () => {
    expect(Object.isFrozen(STUB_EXECUTION_CTX)).toBe(true)
  })
})
