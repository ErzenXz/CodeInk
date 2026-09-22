import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startBridge } from "../main/bridge"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn()
})

test("the unmodified desktop SDK contract drives an external agent with native approvals", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-bridge-"))
  const bridge = await startBridge("127.0.0.1", 0, "test-password", directory, process.env)
  cleanup.push(async () => {
    await bridge.stop()
    await rm(directory, { recursive: true, force: true })
  })
  const address = bridge.server.address()
  if (!address || typeof address === "string") throw new Error("No listener")
  const base = `http://127.0.0.1:${address.port}`
  const headers = {
    Authorization: `Basic ${Buffer.from("opencode:test-password").toString("base64")}`,
    "Content-Type": "application/json",
  }
  const client = createOpencodeClient({ baseUrl: base, headers, directory, throwOnError: true })
  const get = async (path: string) => {
    const response = await fetch(`${base}${path}?directory=${encodeURIComponent(directory)}`, { headers })
    expect(response.ok).toBe(true)
    return response.json()
  }
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${base}${path}?directory=${encodeURIComponent(directory)}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
    expect(response.ok).toBe(true)
    return response.json()
  }
  expect((await fetch(`${base}/global/health`)).status).toBe(401)
  bridge.store.state.agents = []
  await bridge.saveAgent({
    id: "codex",
    name: "Codex",
    protocol: "codex",
    command: process.execPath,
    args: [join(import.meta.dirname, "fixtures/agent.ts"), "codex"],
  })
  let provider = await get("/provider")
  const catalogDeadline = Date.now() + 5000
  while (provider.all[0].options.modelCatalogStatus === "loading") {
    if (Date.now() > catalogDeadline) throw new Error("No model catalog")
    await new Promise((resolve) => setTimeout(resolve, 15))
    provider = await get("/provider")
  }
  expect(provider.connected).toContain("local-codex")
  expect(provider.all[0].models["fixture-model-one"].name).toBe("Codex Model One")
  // Local agent defaults are not dated model releases: the upstream picker hides old dates.
  expect(provider.all[0].models["fixture-model-one"].release_date).toBe("")
  const session = await post("/session", {})
  expect(session.id.startsWith("ses_")).toBe(true)
  await post(`/session/${session.id}/prompt_async`, {
    messageID: "msg_001",
    model: { providerID: "local-codex", modelID: "fixture-model-two" },
    variant: "low",
    parts: [{ type: "text", text: "Hello" }],
  })
  const deadline = Date.now() + 5000
  while (!bridge.sessions.get(session.id).approvals.length) {
    if (Date.now() > deadline) throw new Error("No approval")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const permissions = await get("/permission")
  await client.permission.respond({ sessionID: session.id, permissionID: permissions[0].id, response: "once" })
  while (bridge.sessions.get(session.id).status === "running") {
    if (Date.now() > deadline) throw new Error("Not completed")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const messages = await get(`/session/${session.id}/message`)
  expect(messages).toHaveLength(2)
  expect(messages[0].info.id).toBe("msg_001")
  expect(messages[0].info.model.modelID).toBe("fixture-model-two")
  expect(messages[0].info.model.variant).toBe("low")
  expect(messages[1].info.parentID).toBe("msg_001")
  expect(messages[1].parts.find((part: { type: string }) => part.type === "text").text).toBe(
    "Hello 🌍\u2028from your agent",
  )
  expect(messages[1].parts.find((part: { type: string }) => part.type === "tool")).toMatchObject({
    tool: "bash",
    state: { input: { command: "ls -la" }, output: "README.md", status: "completed" },
  })
  expect(messages[1].info.finish).toBe("stop")
  await writeFile(join(directory, "test.ts"), "export const value = 1")
  expect((await get("/file")).some((item: { name: string }) => item.name === "test.ts")).toBe(true)
})
