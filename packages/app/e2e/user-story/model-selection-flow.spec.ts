import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"

const directory = "C:/CodeInk/NewProject"

test("keeps external-agent models while hiding the retired subscription", async ({ page }) => {
  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_model_selection_flow",
      worktree: directory,
      vcs: "git",
      name: "NewProject",
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      sandboxes: [],
    },
    provider: () => ({
      all: [
        {
          id: "local-codeink",
          name: "CodeInk Agent",
          models: {
            "gateway-free": {
              id: "gateway-free",
              name: "Gateway Free Model",
              cost: { input: 0, output: 0 },
              limit: { context: 200_000 },
            },
            "gateway-fast": {
              id: "gateway-fast",
              name: "Gateway Fast Model",
              cost: { input: 1, output: 1 },
              limit: { context: 200_000 },
            },
          },
        },
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "agent-free": {
              id: "agent-free",
              name: "External Agent Free Model",
              cost: { input: 0, output: 0 },
              limit: { context: 200_000 },
            },
          },
        },
        {
          id: "opencode-go",
          name: "Legacy Subscription",
          models: {
            "go-model-1": {
              id: "go-model-1",
              name: "Go Model 1",
              cost: { input: 1, output: 1 },
              limit: { context: 200_000 },
            },
          },
        },
      ],
      connected: ["local-codeink", "opencode", "opencode-go"],
      default: { providerID: "local-codeink", modelID: "gateway-free" },
    }),
    sessions: [],
    pageMessages: () => ({ items: [] }),
    fileList: (path) =>
      path ? [] : [{ name: "NewProject", path: "NewProject", absolute: directory, type: "directory", ignored: false }],
    findFiles: () => ["NewProject"],
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem("opencode.global.dat:server", JSON.stringify({ projects: { local: [] } }))
  })

  await page.goto("/")
  await expect(page.locator('[data-component="prompt-input-v2"]')).toBeVisible()

  const modelControl = page.locator('[data-action="prompt-model"]')
  await modelControl.click()
  const menu = page.getByRole("menu", { name: "Gateway Free Model" })
  await expect(menu).toContainText("CodeInk Agent")
  await expect(menu).toContainText("Gateway Free Model")
  await expect(menu).toContainText("External Agent Free Model")
  await expect(menu).not.toContainText("Go Model 1")
  await menu.getByRole("menuitemradio", { name: "Gateway Fast Model" }).click()
  await expect(modelControl).toContainText("Gateway Fast Model")

  await modelControl.click()
  await page.getByRole("menuitem", { name: "Manage models" }).click()
  const manage = page.locator('[data-component="dialog-v2"]')
  await expect(manage).toContainText("CodeInk Agent")
  await expect(manage).toContainText("External Agent Free Model")
  await expect(manage).not.toContainText("Legacy Subscription")
})
