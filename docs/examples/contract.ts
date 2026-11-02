import { contextKey, router, routesFor, toFetch, withFilters } from 'oleojs'
import { contractFor, toOpenApi } from 'oleojs/contract'
import { bearerAuth, bodyLimit, problemDetails } from 'oleojs/filters'
import {
  createProjectSchema, cursorSchema, limitSchema, projectIdSchema, projectPageSchema, projectSchema,
} from './project-schemas.ts'
import type { Project, ProjectPage } from './project-schemas.ts'

export interface User { id: string }
export interface Env {
  projects: {
    list(query: { limit: number; cursor: string | undefined }): Promise<ProjectPage>
    create(input: { name: string }): Promise<Project>
    findVisibleTo(id: number, userId: string): Promise<Project | undefined>
  }
  verifyToken(token: string): Promise<User | undefined>
}

// Bind Env once so routes declared on their own need no Route<Env> annotations.
const { group } = routesFor<Env>()
const contract = contractFor<Env>()

const listProjects = contract({
  method: 'GET', path: '/projects', operationId: 'listProjects', summary: 'List projects',
  request: { query: {
    limit: { schema: limitSchema, required: false },
    cursor: { schema: cursorSchema, required: false },
  } },
  responses: { 200: { description: 'Project page', content: { 'application/json': { schema: projectPageSchema } } } },
}, async (_request, ctx, { query }) => Response.json(await ctx.env.projects.list(query)))

const createProject = contract({
  method: 'POST', path: '/projects', operationId: 'createProject', summary: 'Create a project',
  request: { json: createProjectSchema },
  responses: { 201: { description: 'Created project', content: { 'application/json': { schema: projectSchema } } } },
}, async (_request, ctx, { json }) => {
  const project = await ctx.env.projects.create(json)
  return Response.json(project, { status: 201 })
})

const userKey = contextKey<User>('user')
const authenticatedProject = group('', {
  filters: [bearerAuth({ key: userKey, verify: (token, _request, ctx) => ctx.env.verifyToken(token) })],
}, contract({
  method: 'GET', path: '/projects/:projectId', operationId: 'getProject', summary: 'Read a visible project',
  request: { params: { projectId: { schema: projectIdSchema } } },
  security: [{ bearer: [] }],
  responses: {
    200: { description: 'Project', content: { 'application/json': { schema: projectSchema } } },
    400: { description: 'Malformed path encoding or Bearer credentials' },
    401: { description: 'Authentication required' },
    404: { description: 'Project not found or not visible' },
  },
}, async (_request, ctx, { params }) => {
  // ctx.params.projectId is the decoded string; params.projectId is the validated number.
  const user = userKey.get(ctx)
  const project = await ctx.env.projects.findVisibleTo(params.projectId, user.id)
  if (project === undefined) return new Response(null, { status: 404 })
  return Response.json(project)
}))

export const routes = group('/api', listProjects, createProject, authenticatedProject)

export const document = toOpenApi({
  info: { title: 'Projects API', version: '1.0.0' },
  securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
}, routes)

// app.fetch(request, env) requires Env; the hosting adapter or runtime supplies it in production.
// bodyLimit bounds the JSON bodies that contracts read; problemDetails renders its 413.
export default toFetch(withFilters(router(routes), problemDetails(), bodyLimit({ maxBytes: 64 * 1024 })))
