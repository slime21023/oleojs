// #region modules
// users.ts
import { routesFor } from 'oleojs'

interface Env {
  users: { find(id: string): Promise<{ id: string; name: string } | undefined> }
}

const { get, group } = routesFor<Env>()

export const users = group('/users',
  get('/:id', async (_request, ctx) => {
    const user = await ctx.env.users.find(ctx.params.id)
    return user === undefined ? new Response(null, { status: 404 }) : Response.json(user)
  }),
)

// app.ts
// import { router, toFetch } from 'oleojs'
// export default toFetch(router<Env>(users))
// #endregion modules
