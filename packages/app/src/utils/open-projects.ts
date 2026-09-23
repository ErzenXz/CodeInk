import type { ServerCtx } from "@/context/global"

/** Opens directories as projects, initializing Git for empty folders so they get a project identity. */
export function openProjects(ctx: ServerCtx, directories: string[]) {
  directories.forEach((directory) => {
    if (ctx.projects.list().some((project) => project.worktree === directory)) return
    const location = { directory }
    void ctx.sdk.api.file
      .list({ path: ".", location })
      .then(async (files) => {
        if (files.data.length > 0) return ctx.sdk.api.project.current({ location })
        const result = await ctx.sdk.client.project.initGit({ directory })
        return result.data ?? ctx.sdk.api.project.current({ location })
      })
      .then((project) => ctx.sync.child(directory, { bootstrap: false })[1]("project", project.id))
      .catch(() => undefined)
    ctx.projects.open(directory)
  })
  if (directories[0]) ctx.projects.touch(directories[0])
}
