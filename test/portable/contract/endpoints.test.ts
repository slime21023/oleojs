import { expect, it, vi } from 'vitest'
import { contract, toOpenApi } from '../../../src/contract/index.ts'
import { contextKey, group, router, toFetch, withFilters } from '../../../src/index.ts'
import type { Route, RouteGroup } from '../../../src/index.ts'
import { bearerAuth, problemDetails } from '../../../src/filters/index.ts'
import { createSchema, cursorSchema, idSchema, info, limitSchema, schema } from './fixtures.ts'

it('serves a list, creates data, and authenticates access using the same documented routes', async () => {
  interface User { id: string }
  interface Project { id: number; name: string }
  interface Env {
    list(query: { limit: number; cursor: string | undefined }): Promise<Project[]>
    create(value: { name: string }): Promise<Project>
    findVisibleTo(id: number, user: string): Promise<Project | undefined>
    verifyToken(token: string): Promise<User | undefined>
  }
  const env: Env = {
    list: vi.fn(async () => [{ id: 1, name: 'first' }]),
    create: vi.fn(async ({ name }) => ({ id: 2, name })),
    findVisibleTo: vi.fn(async (id, user) => id === 1 && user === 'user' ? { id, name: 'first' } : undefined),
    verifyToken: vi.fn(async (token) => token === 'valid' ? { id: 'user' } : undefined),
  }
  const output = schema<Project>(() => { throw new Error('Response schemas must not validate') }, { type: 'object', required: ['id', 'name'], properties: { id: { type: 'integer' }, name: { type: 'string' } } })
  const ok = { description: 'Project', content: { 'application/json': { schema: output } } }
  const list: Route<Env> = contract({ method: 'GET', path: '/projects', operationId: 'listProjects', request: { query: {
    limit: { schema: limitSchema, required: false }, cursor: { schema: cursorSchema, required: false },
  } }, responses: { 200: { description: 'Projects' } } }, async (_req, ctx, { query }) => Response.json(await ctx.env.list(query)))
  const create: Route<Env> = contract({ method: 'POST', path: '/projects', operationId: 'createProject', request: { json: createSchema }, responses: { 201: ok } },
    async (_req, ctx, { json }) => Response.json(await ctx.env.create(json), { status: 201 }))
  const userKey = contextKey<User>('user')
  const protectedRoute: RouteGroup<Env> = group('', { filters: [bearerAuth({ key: userKey, verify: (token, _req, ctx) => ctx.env.verifyToken(token) })] }, contract({
    method: 'GET', path: '/projects/:projectId', operationId: 'getProject', request: { params: { projectId: { schema: idSchema } } },
    security: [{ bearer: [] }], responses: { 200: ok, 401: { description: 'Authentication required' }, 404: { description: 'Not found' } },
  }, async (_req, ctx, { params }) => {
    expect(ctx.params.projectId).toBe(String(params.projectId))
    const project = await ctx.env.findVisibleTo(params.projectId, userKey.get(ctx).id)
    return project === undefined ? new Response(null, { status: 404 }) : Response.json(project)
  }))
  const routes: RouteGroup<Env> = group('/api', list, create, protectedRoute)
  const document = toOpenApi({ info, securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } }, routes)
  expect(env.verifyToken).not.toHaveBeenCalled()
  expect(Object.keys(document.paths)).toEqual(['/api/projects', '/api/projects/{projectId}'])
  const app = toFetch(withFilters(router(routes), problemDetails()))
  const call = (path: string, init?: RequestInit) => app.fetch(new Request(`https://test/api${path}`, init), env)
  expect(await (await call('/projects')).json()).toEqual([{ id: 1, name: 'first' }])
  expect(env.list).toHaveBeenCalledExactlyOnceWith({ limit: 20, cursor: undefined })
  expect((await call('/projects?limit=0')).status).toBe(422)
  expect(env.list).toHaveBeenCalledOnce()
  const created = await call('/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"second"}' })
  expect(created.status).toBe(201)
  expect(await created.json()).toEqual({ id: 2, name: 'second' })
  expect(env.create).toHaveBeenCalledExactlyOnceWith({ name: 'second' })
  expect((await call('/projects/no')).status).toBe(401)
  expect(env.findVisibleTo).not.toHaveBeenCalled()
  expect((await call('/projects/1', { headers: { Authorization: 'Bearer bad token' } })).status).toBe(400)
  expect((await call('/projects/1', { headers: { Authorization: 'Bearer invalid' } })).status).toBe(401)
  expect((await call('/projects/no', { headers: { Authorization: 'Bearer valid' } })).status).toBe(422)
  expect(env.findVisibleTo).not.toHaveBeenCalled()
  expect(await (await call('/projects/1', { headers: { Authorization: 'Bearer valid' } })).json()).toEqual({ id: 1, name: 'first' })
  expect((await call('/projects/2', { headers: { Authorization: 'Bearer valid' } })).status).toBe(404)
  expect((await call('/projects/%ZZ', { headers: { Authorization: 'Bearer valid' } })).status).toBe(400)
  expect((await call('/projects/1', { method: 'HEAD', headers: { Authorization: 'Bearer valid' } })).body).toBeNull()
})
