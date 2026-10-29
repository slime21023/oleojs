import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { problemDetails } from '../../../src/filters/index.ts'
import { toFetch } from '../../../src/index.ts'
import { PROPERTY_OPTIONS } from '../arbitraries.ts'

const errorStatus = fc.integer({ min: 400, max: 599 })
const request = (method = 'GET') => new Request('https://example.test/', { method })

describe('problemDetails properties', () => {
  it('preserves status and custom headers without mutating empty error responses', async () => {
    const headers = fc.dictionary(
      fc.stringMatching(/^x-[a-z]{1,12}$/),
      fc.stringMatching(/^[a-z0-9-]{0,30}$/),
      { maxKeys: 4 },
    )
    await fc.assert(fc.asyncProperty(errorStatus, headers, fc.constantFrom('GET', 'POST', 'HEAD'), async (status, headers, method) => {
      const original = new Response(null, { status, headers })
      const before = [...original.headers]
      const response = await toFetch(problemDetails()(() => original)).fetch(request(method))
      expect(response.status).toBe(status)
      expect(response.headers.get('Content-Type')).toBe('application/problem+json')
      for (const [name, value] of before) expect(response.headers.get(name)).toBe(value)
      expect([...original.headers]).toEqual(before)
      expect(original.body).toBeNull()
      if (method === 'HEAD') expect(response.body).toBeNull()
      else expect(await response.json()).toMatchObject({ status, type: 'about:blank' })
    }), PROPERTY_OPTIONS)
  })

  it('uses the same generic 500 document for arbitrary thrown values', async () => {
    await fc.assert(fc.asyncProperty(fc.jsonValue(), async (error) => {
      const reported: unknown[] = []
      const handler = problemDetails({ onError: (value) => { reported.push(value) } })(() => { throw error })
      const response = await toFetch(handler).fetch(request())
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ status: 500, type: 'about:blank', title: 'Internal Server Error' })
      expect(reported).toEqual([error])
    }), PROPERTY_OPTIONS)
  })

  it('leaves existing error bodies unread and unchanged', async () => {
    await fc.assert(fc.asyncProperty(errorStatus, fc.string(), async (status, body) => {
      const original = new Response(body, { status })
      const response = await toFetch(problemDetails()(() => original)).fetch(request())
      expect(response).toBe(original)
      expect(response.bodyUsed).toBe(false)
      expect(await response.text()).toBe(await new Response(body).text())
    }), PROPERTY_OPTIONS)
  })

  it('preserves mapped fields and JSON extensions with a matching HTTP status', async () => {
    const problems = fc.record({
      status: errorStatus,
      type: fc.constant('https://example.test/problems/generated'),
      title: fc.string(),
      detail: fc.string(),
      instance: fc.uuid().map((id) => `/errors/${id}`),
      metadata: fc.jsonValue(),
    })
    await fc.assert(fc.asyncProperty(problems, async (problem) => {
      const handler = problemDetails({ fromError: () => Object.freeze(problem), onError: () => {} })(() => {
        throw new Error('mapped')
      })
      const response = await toFetch(handler).fetch(request())
      expect(response.status).toBe(problem.status)
      // Compare JSON values: serialization normalizes numbers such as -0 to 0.
      expect(await response.json()).toEqual(JSON.parse(JSON.stringify(problem)))
    }), {
      ...PROPERTY_OPTIONS,
      examples: [[{
        status: 400,
        type: 'https://example.test/problems/generated',
        title: '',
        detail: '',
        instance: '/errors/00000000-0000-1000-8000-000000000000',
        metadata: [-0],
      }]],
    })
  })
})
