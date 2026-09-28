import { expect, test } from "@playwright/test"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

;(["sidebar", "top"] as const).forEach((mode) =>
  test(`opens the centered composer without projects in ${mode} mode`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await mockOpenCodeServer(page, {
      protocol: "v1",
      sessions: [],
      provider: fixture.provider,
      directory: fixture.directory,
      project: fixture.project,
      projects: [],
      fileList: () => [],
      pageMessages,
    })
    await page.addInitScript((mode) => {
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({ general: { newLayoutDesigns: true, sessionTabPosition: mode } }),
      )
      localStorage.setItem("opencode.global.dat:server", JSON.stringify({ projects: { local: [] } }))
    }, mode)

    await page.goto("/")
    await expect(page).toHaveURL(/\/new-session\?draftId=/)
    await expect(page.locator('[data-component="new-session-context"]')).toBeVisible()
    await expect(page.locator('[data-component="prompt-input-v2"]')).toBeVisible()
    await expect(page.locator('[data-component="home-session-search"]')).toHaveCount(0)
    if (mode === "sidebar") await expect(page.getByRole("complementary", { name: "Sessions" })).toBeVisible()
    else await expect(page.getByRole("complementary", { name: "Sessions" })).toHaveCount(0)

    await page.locator('[data-component="prompt-input"]').fill("Keep this draft")
    await page.getByRole("button", { name: "Send" }).click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await expect(page.locator('[data-component="prompt-input"]')).toContainText("Keep this draft")
  }),
)

test("keeps the project overview in top bar mode and shows context only for a new chat", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await mockOpenCodeServer(page, {
    protocol: "v1",
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
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
  }, fixture.directory)

  await page.goto("/")
  await expect(page.locator('[data-component="home-session-search"]')).toBeVisible()
  await expect(page.getByRole("complementary", { name: "Sessions" })).toHaveCount(0)
  await page.locator('[data-action="home-new-session"]').click()
  await expect(page.locator('[data-component="new-session-context"]')).toBeVisible()
  await expect(page.locator('[data-component="new-session-context"]')).toContainText("Local")
  await expect(page.locator('[data-component="new-session-context"]')).toContainText("main")
  await expect(page.locator('[data-component="prompt-input-v2"]')).toBeVisible()

  await page.goto(`/server/${Buffer.from(fixture.serverKey).toString("base64url")}/session/${fixture.targetID}`)
  await expect(page.getByRole("heading", { name: fixture.expected.targetTitle, exact: true })).toBeVisible()
  await expect(page.locator('[data-component="new-session-context"]')).toHaveCount(0)
})
