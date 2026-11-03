// #region contract
import { router, toFetch } from 'oleojs'
import { contract, toOpenApi } from 'oleojs/contract'
import { createProjectSchema, limitSchema, projectIdSchema } from './project-schemas.ts'

const listProjects = contract({
  method: 'GET',
  path: '/projects',
  operationId: 'listProjects',
  request: { query: { limit: { schema: limitSchema, required: false } } },
  responses: { 200: { description: 'A page of projects' } },
}, (_request, _ctx, { query }) => Response.json({ limit: query.limit })) // query.limit is a number

const getProject = contract({
  method: 'GET',
  path: '/projects/:id',
  operationId: 'getProject',
  request: { params: { id: { schema: projectIdSchema } } },
  responses: { 200: { description: 'The project' } },
}, (_request, _ctx, { params }) => Response.json({ id: params.id, name: 'Example' }))

const createProject = contract({
  method: 'POST',
  path: '/projects',
  operationId: 'createProject',
  request: { json: createProjectSchema },
  responses: { 201: { description: 'The created project' } },
}, (_request, _ctx, { json }) => Response.json({ id: 1, name: json.name }, { status: 201 }))

export default toFetch(router(listProjects, getProject, createProject))
// #endregion contract

// #region openapi
export const document = toOpenApi(
  { info: { title: 'Projects API', version: '1.0.0' } },
  listProjects, getProject, createProject,
)

// Serve the document from an ordinary route if you like:
// get('/openapi.json', () => Response.json(document))
// #endregion openapi
