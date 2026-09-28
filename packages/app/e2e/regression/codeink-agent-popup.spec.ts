import { expect, test } from "@playwright/test"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

test("introduces CodeInk Agent and opens its settings", async ({ page }) => {
  await mockOpenCodeServer(page, {
    protocol: "v1",
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
  })
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayAgentToast: true } }),
    )
  })
  await page.goto("/")
  const card = page.getByLabel("Introducing CodeInk Agent")
  await expect(card).toBeVisible()
  await expect(card).not.toContainText("Tabs")
  await card.getByRole("button", { name: /Introducing CodeInk Agent/ }).click()
  await expect(page.getByRole("heading", { name: "Introducing CodeInk Agent" })).toBeVisible()
  await page.getByRole("button", { name: "Set up CodeInk Agent" }).click()
  await expect(page).toHaveURL(/\/settings\?tab=codeink-agent/)
  await expect(card).toBeHidden()
})

test("keeps the Agent drawer open during composer focus and closes it from the close button", async ({ page }) => {
  await mockOpenCodeServer(page, {
    protocol: "v1",
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
  })
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true, shouldDisplayAgentToast: true } }),
    )
  })
  await page.goto("/")
  const card = page.getByLabel("Introducing CodeInk Agent")
  await card.getByRole("button", { name: /Introducing CodeInk Agent/ }).click()
  const drawer = page.getByRole("dialog")
  await expect(drawer).not.toHaveAttribute("data-transitioning", "")
  await expect(drawer.getByRole("button", { name: "Close" })).toBeInViewport()
  await drawer.getByRole("button", { name: "Close" }).click()
  await expect(drawer).toBeHidden()
  await expect(card).toBeHidden()
})
