import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"

const directory = fixture.directory

for (const known of [true, false]) {
  test(`new chat offers Git branches for a ${known ? "known" : "newly discovered"} project`, async ({ page }) => {
    const project = {
      id: fixture.project.id,
      worktree: directory,
      vcs: "git",
      name: "GitProject",
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      sandboxes: ["C:/CodeInk/GitProject-feature"],
      codeinkBranches: ["main", "feature/login"],
    }
    const projects: unknown[] = []
    await mockOpenCodeServer(page, {
      protocol: "v1",
      projects: known ? undefined : projects,
      directory,
      project,
      provider: fixture.provider,
      sessions: fixture.sessions,
      pageMessages,
      fileList: () => [],
    })
    // The desktop registers a previously unknown project when it is opened.
    if (!known)
      await page.route("**/project/current*", async (route) => {
        if (projects.length === 0) projects.push(project)
        await route.fallback()
      })
    await page.addInitScript((directory) => {
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({ general: { newLayoutDesigns: true, sessionTabPosition: "top" } }),
      )
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
    }, directory)

    await page.goto("/")
    await page.locator('[data-action="home-new-session"]').click()
    await expect(page.locator('[data-component="new-session-context"]')).toContainText("main")
    await page.locator('[data-component="new-session-context"]').getByRole("button", { name: /main/i }).click()
    await expect(page.getByRole("menu")).toContainText("New workspace")
    await expect(page.getByRole("menu")).toContainText("Workspace")
    await page.getByRole("menuitem", { name: "Branches" }).hover()
    await expect(page.getByRole("menuitem", { name: "feature/login" })).toBeVisible()
    await page.getByRole("menuitem", { name: "feature/login" }).click()
    await expect(page.locator('[data-component="new-session-context"]')).toContainText("feature/login")
    await page.getByRole("button", { name: "Choose project or server" }).click()
    await expect(page.locator("#prompt-project-menu")).toBeVisible()
  })
}
