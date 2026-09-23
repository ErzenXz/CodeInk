import { expect, test } from "@playwright/test"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

test("shows project sessions and activity in the sidebar, then moves to the top bar", async ({ page }) => {
  await mockOpenCodeServer(page, {
    protocol: "v1",
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
    sessionStatus: { [fixture.sourceID]: { type: "busy" } },
  })
  await page.addInitScript((directory) => {
    if (!localStorage.getItem("settings.v3"))
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: directory, expanded: true }] },
        lastProject: { local: directory },
      }),
    )
  }, fixture.directory)

  await page.goto(`/server/${Buffer.from(fixture.serverKey).toString("base64url")}/session/${fixture.targetID}`)
  await expect(page.getByRole("heading", { name: fixture.expected.targetTitle, exact: true })).toBeVisible()

  const sidebar = page.getByRole("complementary", { name: "Sessions" })
  await expect(sidebar.getByText("CodeInk", { exact: true })).toBeVisible()
  await expect(sidebar.locator('[data-action="sidebar-new-session"]')).toContainText("New chat")
  await expect(sidebar.locator('[data-slot="session-sidebar-toolbar"]')).toBeVisible()
  expect(
    await sidebar.locator('[data-slot="session-sidebar-toolbar"]').evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      fits: element.scrollWidth <= element.clientWidth,
    })),
  ).toEqual({ height: 32, fits: true })
  await expect(sidebar.locator('[data-action="sidebar-view"]')).toContainText("Sessions")
  await expect(sidebar.locator('[data-action="sidebar-search-toggle"]')).toBeVisible()
  await expect(sidebar.locator('[data-action="sidebar-filters"]')).toBeVisible()
  await expect(sidebar.locator('[data-sidebar-group^="project:"]')).toBeVisible()
  await expect(sidebar.locator('[data-sidebar-group^="project:"] [data-action="sidebar-group"]')).toBeVisible()
  await expect(page.locator('[data-slot="titlebar-v2"]').getByRole("button", { name: "Settings" })).toBeHidden()
  await expect(sidebar.locator(`[data-session-id="${fixture.targetID}"]`)).toBeVisible()
  await sidebar.locator('[data-action="sidebar-view"]').click()
  await page.getByRole("menuitemradio", { name: "Activity" }).click()
  await expect(sidebar.locator('[data-action="sidebar-view"]')).toContainText("Activity")
  await expect(sidebar.locator(`[data-session-id="${fixture.sourceID}"]`)).toBeVisible()
  expect(
    await sidebar
      .locator(`[data-session-id="${fixture.sourceID}"]`)
      .evaluate(
        (element) =>
          element.querySelector('[data-slot="sidebar-session-state"]')!.getBoundingClientRect().right <=
          element.querySelector('[data-slot="sidebar-session-title"]')!.getBoundingClientRect().left,
      ),
  ).toBe(true)
  await expect(sidebar.locator(`[data-session-id="${fixture.targetID}"]`)).toBeHidden()
  await expect(sidebar.locator('[data-action="sidebar-session"]')).toHaveCount(1)
  await sidebar.locator('[data-action="sidebar-filters"]').click()
  await expect(page.locator('[data-action="sidebar-filter-status"]')).toContainText("Active")
  await page.locator('[data-action="sidebar-filter-group-by"]').click()
  await page.getByRole("menuitemradio", { name: "Workspace" }).click()
  await sidebar.locator('[data-action="sidebar-filters"]').click()
  await expect(page.locator('[data-action="sidebar-filter-group-by"]')).toContainText("Workspace")
  await page.locator('[data-action="sidebar-filter-group-by"]').click()
  await page.getByRole("menuitemradio", { name: "Status" }).click()
  await expect(sidebar.locator('[data-sidebar-group="working"]')).toBeVisible()
  await sidebar.locator('[data-action="sidebar-view"]').click()
  await page.getByRole("menuitemradio", { name: "All" }).click()
  await sidebar.locator('[data-action="sidebar-search-toggle"]').click()
  await sidebar.locator('[data-action="sidebar-search-input"]').fill(fixture.expected.targetTitle)
  await expect(sidebar.locator(`[data-session-id="${fixture.targetID}"]`)).toBeVisible()
  await expect(sidebar.locator(`[data-session-id="${fixture.sourceID}"]`)).toBeHidden()
  await sidebar.locator('[data-action="sidebar-search-toggle"]').click()

  await sidebar.locator('[data-action="sidebar-settings"]').click()
  await expect(page).toHaveURL(/\/settings/)
  await page.getByRole("tab", { name: "Appearance" }).click()
  await page.locator('[data-action="settings-session-tabs"]').click()
  await page.getByRole("option", { name: "Top bar" }).click()

  await expect(sidebar).toBeHidden()
  await expect(page.locator('[data-slot="titlebar-v2"]').getByRole("button", { name: "Settings" })).toBeVisible()
  await expect(
    page.locator('[data-slot="titlebar-v2"] [data-slot="titlebar-tabs"][data-orientation="horizontal"]'),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.locator('[data-slot="titlebar-v2"] [data-slot="titlebar-tabs"][data-orientation="horizontal"]'),
  ).toBeVisible()

  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("settings.v3") ?? "{}")
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ ...saved, general: { ...saved.general, sessionTabPosition: "sidebar" } }),
    )
  })
  await page.setViewportSize({ width: 800, height: 800 })
  await page.reload()
  await expect(page.locator('[data-slot="titlebar-tabs"][data-orientation="horizontal"]')).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(sidebar.locator('[data-slot="session-sidebar-list"]')).toBeVisible()
})

test("reuses an empty draft when New chat is clicked repeatedly", async ({ page }) => {
  await mockOpenCodeServer(page, {
    protocol: "v1",
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
  })
  await page.addInitScript((directory) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: directory, expanded: true }] },
        lastProject: { local: directory },
      }),
    )
  }, fixture.directory)

  await page.goto("/")
  const sidebar = page.getByRole("complementary", { name: "Sessions" })
  await sidebar.locator('[data-action="sidebar-new-session"]').click()
  await expect(page).toHaveURL(/\/new-session\?draftId=/)
  const first = new URL(page.url()).searchParams.get("draftId")
  await sidebar.locator('[data-action="sidebar-new-session"]').click()

  await expect(page).toHaveURL(new RegExp(`draftId=${first}`))
  await expect(sidebar.locator('[data-action="sidebar-session"]').filter({ hasText: "New chat" })).toHaveCount(1)

  await page.locator('[data-component="prompt-input-v2"] [data-component="prompt-input"]').fill("unfinished idea")
  await sidebar.locator('[data-action="sidebar-new-session"]').click()
  await expect(page).toHaveURL(/\/new-session\?draftId=/)
  expect(new URL(page.url()).searchParams.get("draftId")).not.toBe(first)
  await expect(sidebar.locator('[data-action="sidebar-session"]').filter({ hasText: "unfinished idea" })).toHaveCount(1)
  await sidebar.locator('[data-action="sidebar-session"]').filter({ hasText: "unfinished idea" }).click()
  await expect(page.locator('[data-component="prompt-input-v2"] [data-component="prompt-input"]')).toHaveText(
    "unfinished idea",
  )
})

test("collapses previously saved empty drafts", async ({ page }) => {
  await mockOpenCodeServer(page, {
    protocol: "v1",
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
  })
  await page.addInitScript(
    ({ directory, server }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify(
          ["draft_saved_a", "draft_saved_b", "draft_saved_c"].map((draftID) => ({
            type: "draft",
            draftID,
            server,
            directory,
          })),
        ),
      )
    },
    {
      directory: fixture.directory,
      server: `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`,
    },
  )

  await page.goto("/new-session?draftId=draft_saved_b")
  const sidebar = page.getByRole("complementary", { name: "Sessions" })
  await expect(sidebar.locator("[data-draft-id]")).toHaveCount(1)
  await expect(sidebar.locator('[data-draft-id="draft_saved_b"]')).toBeVisible()
  await sidebar.locator('[data-action="sidebar-new-session"]').click()
  await expect(page).toHaveURL(/draftId=draft_saved_b/)
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("opencode.window.browser.dat:tabs") ?? "[]").filter(
            (tab: { type: string }) => tab.type === "draft",
          ).length,
      ),
    )
    .toBe(1)
})

test("pages long project chats and keeps an open chat visible across layouts", async ({ page }) => {
  const sessions = Array.from({ length: 18 }, (_, index) => ({
    ...fixture.sessions[0],
    id: `ses_sidebar_page_${String(index).padStart(2, "0")}`,
    title: `Paged chat ${String(index).padStart(2, "0")}`,
    time: { created: 1_700_000_000_000 + index, updated: 1_700_000_000_000 + index },
  }))
  await mockOpenCodeServer(page, {
    protocol: "v1",
    sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript((directory) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: directory, expanded: true }] },
        lastProject: { local: directory },
      }),
    )
  }, fixture.directory)

  await page.goto("/")
  const sidebar = page.getByRole("complementary", { name: "Sessions" })
  const project = sidebar.locator('[data-sidebar-group^="project:"]')
  await expect(project.locator('[data-action="sidebar-session"]')).toHaveCount(5)
  await expect(project.locator('[data-slot="sidebar-session-count"]')).toHaveCount(0)
  await project.locator('[data-action="sidebar-group-more"]').click()
  await expect(project.locator('[data-action="sidebar-session"]')).toHaveCount(12)
  await project.locator('[data-action="sidebar-group-more"]').click()
  await expect(project.locator('[data-action="sidebar-session"]')).toHaveCount(18)
  await expect(project.locator('[data-action="sidebar-group-more"]')).toHaveCount(0)

  await project.locator('[data-session-id="ses_sidebar_page_00"]').click()
  await expect(page).toHaveURL(/ses_sidebar_page_00/)
  await project.locator('[data-action="sidebar-group-less"]').click()
  await expect(project.locator('[data-action="sidebar-session"]')).toHaveCount(7)
  await sidebar.locator('[data-action="sidebar-settings"]').click()
  await page.getByRole("tab", { name: "Appearance" }).click()
  await page.locator('[data-action="settings-session-tabs"]').click()
  await page.getByRole("option", { name: "Top bar" }).click()
  await expect(sidebar).toBeHidden()
  await expect(page).toHaveURL(/\/settings/)
  await expect(
    page.locator('[data-slot="titlebar-tabs"] [data-titlebar-tab]').filter({ hasText: "Paged chat 00" }),
  ).toBeVisible()
  await page.locator('[data-action="settings-session-tabs"]').click()
  await page.getByRole("option", { name: "Sidebar" }).click()
  await expect(sidebar.locator('[data-session-id="ses_sidebar_page_00"]')).toBeVisible()
  await expect(project.locator('[data-action="sidebar-session"]')).toHaveCount(7)
  await sidebar.locator('[data-session-id="ses_sidebar_page_00"]').click()
  await expect(page).toHaveURL(/\/session\/ses_sidebar_page_00$/)
})

test("pages project groups while keeping a project with an open chat visible", async ({ page }) => {
  const projects = Array.from({ length: 12 }, (_, index) => ({
    ...fixture.project,
    id: `proj_sidebar_${String(index + 1).padStart(2, "0")}`,
    worktree: `C:/OpenCode/SidebarProject${String(index + 1).padStart(2, "0")}`,
    name: `Sidebar project ${String(index + 1).padStart(2, "0")}`,
  }))
  const last = projects[11]
  const session = {
    ...fixture.sessions[0],
    id: "ses_sidebar_last_project",
    projectID: last.id,
    directory: last.worktree,
    title: "Open in last project",
  }
  await mockOpenCodeServer(page, {
    protocol: "v1",
    sessions: [session],
    provider: fixture.provider,
    directory: projects[0].worktree,
    project: projects[0],
    projects,
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(
    ({ projects, server }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: projects.map((project) => ({ worktree: project.worktree, expanded: true })) },
          lastProject: { local: projects[0].worktree },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "session", server, sessionId: "ses_sidebar_last_project" }]),
      )
    },
    {
      projects,
      server: `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`,
    },
  )

  await page.goto("/")
  const sidebar = page.getByRole("complementary", { name: "Sessions" })
  await expect(sidebar.locator('[data-sidebar-group^="project:"]')).toHaveCount(9)
  await expect(sidebar.getByText("Sidebar project 12", { exact: true })).toBeVisible()
  await expect(sidebar.getByText("Sidebar project 09", { exact: true })).toHaveCount(0)
  await expect(sidebar.locator('[data-session-id="ses_sidebar_last_project"]')).toBeVisible()
  await sidebar.locator('[data-action="sidebar-projects-more"]').click()
  await expect(sidebar.locator('[data-sidebar-group^="project:"]')).toHaveCount(12)
  await expect(sidebar.locator('[data-action="sidebar-projects-more"]')).toHaveCount(0)
  await sidebar.locator('[data-action="sidebar-projects-less"]').click()
  await expect(sidebar.locator('[data-sidebar-group^="project:"]')).toHaveCount(9)
  await expect(sidebar.locator('[data-session-id="ses_sidebar_last_project"]')).toBeVisible()
})

test("keeps the chat canvas flat in sidebar mode and restores its frame in top-bar mode", async ({ page }) => {
  await mockOpenCodeServer(page, {
    protocol: "v1",
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
  })
  await page.addInitScript((directory) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: directory, expanded: true }] },
        lastProject: { local: directory },
      }),
    )
  }, fixture.directory)

  await page.goto(`/server/${btoa(fixture.serverKey)}/session/${fixture.targetID}`)
  const sidebar = page.getByRole("complementary", { name: "Sessions" })
  await expect(sidebar).toHaveCSS("border-right-width", "0px")
  const panel = page.locator('[data-slot="session-panel-frame"]').first()
  await expect(panel).toHaveCSS("border-top-left-radius", "0px")
  await expect(panel).toHaveCSS("box-shadow", "none")

  await sidebar.locator('[data-action="sidebar-settings"]').click()
  await page.getByRole("tab", { name: "Appearance" }).click()
  await page.locator('[data-action="settings-session-tabs"]').click()
  await page.getByRole("option", { name: "Top bar" }).click()
  await page
    .locator('[data-slot="titlebar-tabs"] [data-titlebar-tab]')
    .filter({ hasText: fixture.expected.targetTitle })
    .click()
  await expect(panel).toHaveCSS("border-top-left-radius", "10px")
  expect(await panel.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none")
})

test("offers project and chat right-click actions", async ({ page }) => {
  await mockOpenCodeServer(page, {
    protocol: "v1",
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
  })
  await page.addInitScript((directory) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: directory, expanded: true }] },
        lastProject: { local: directory },
      }),
    )
  }, fixture.directory)

  await page.goto("/")
  const sidebar = page.getByRole("complementary", { name: "Sessions" })
  const project = sidebar.locator('[data-sidebar-group^="project:"]')
  await project.locator('[data-action="sidebar-group"]').click({ button: "right" })
  await expect(page.locator('[data-action="sidebar-project-open"]')).toBeVisible()
  await expect(page.locator('[data-action="sidebar-project-new-chat"]')).toBeVisible()
  await expect(page.locator('[data-action="sidebar-project-edit"]')).toBeVisible()
  await expect(page.locator('[data-action="sidebar-project-copy-path"]')).toBeVisible()
  await expect(page.locator('[data-action="sidebar-project-close"]')).toBeVisible()
  await page.locator('[data-action="sidebar-project-new-chat"]').click()
  await expect(page).toHaveURL(/\/new-session\?draftId=/)
  await expect(page.locator('[data-component="prompt-input-v2"]')).toBeVisible()
  await expect(project.locator("[data-draft-id]")).toBeVisible()

  const chat = project.locator(`[data-session-id="${fixture.targetID}"]`)
  await chat.click({ button: "right" })
  await expect(page.locator('[data-action="sidebar-session-open"]')).toBeVisible()
  await expect(page.locator('[data-action="sidebar-session-rename"]')).toBeVisible()
  await expect(page.locator('[data-action="sidebar-session-copy-link"]')).toBeVisible()
  await expect(page.locator('[data-action="sidebar-session-copy-id"]')).toBeVisible()
  await page.locator('[data-action="sidebar-session-rename"]').click()
  await expect(page.getByRole("dialog", { name: "Rename chat" })).toBeVisible()
  await page.getByRole("textbox", { name: "Chat name" }).fill("Renamed from sidebar")
  await page.getByRole("button", { name: "Save" }).click()
  await expect(chat).toContainText("Renamed from sidebar")
})
