import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { connectAgent, defaults } from "../main/agents"
import { discoverModels } from "../main/adapters/model-discovery"
import { object } from "../main/adapters/types"
import { WorkspaceStore } from "../main/agent-store"
import type { AgentEvent, AgentStatus } from "../shared/types"
const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn()
})
const agent: AgentStatus = {
  id: "gemini",
  name: "Gemini CLI",
  protocol: "acp",
  command: process.execPath,
  executable: process.execPath,
  args: [join(import.meta.dirname, "fixtures/agent.ts"), "acp"],
}
async function eventually(check: () => boolean) {
  const end = Date.now() + 5000
  while (!check()) {
    if (Date.now() > end) throw new Error("Timed out")
    await new Promise((r) => setTimeout(r, 10))
  }
}
for (const legacy of [false, true]) {
  test(`ACP discovers ${legacy ? "legacy models" : "config options"} without prompting and removes its probe session`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "codeink-acp-catalog-"))
    cleanup.push(() => rm(directory, { recursive: true, force: true }))
    const log = join(directory, "requests.jsonl")
    const models = await discoverModels({
      agent,
      directory,
      env: { ...process.env, CODEINK_FIXTURE_RECORD: log, ...(legacy ? { CODEINK_FIXTURE_ACP_LEGACY: "1" } : {}) },
      signal: AbortSignal.timeout(5000),
    })
    expect(models.map((m) => m.id)).toEqual(["acp-one", "acp-two"])
    expect(models[0].default).toBe(true)
    expect(models[0].variants).toEqual(legacy ? [] : ["low", "high"])
    const records = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((s) => object(JSON.parse(s)))
    expect(records.some((r) => r.method === "session/prompt")).toBe(false)
    expect(records.some((r) => r.method === "session/delete")).toBe(true)
  })
}
test("ACP streams real tool details, forwards model/effort, maps approvals once and resumes without replay duplication", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-acp-turn-"))
  const log = join(directory, "requests.jsonl")
  const image = join(directory, "image.png")
  await writeFile(image, await readFile(join(import.meta.dirname, "../../icons/codeink/32x32.png")))
  const events: AgentEvent[] = []
  const make = (remoteID?: string) =>
    connectAgent({
      agent,
      executable: process.execPath,
      directory,
      env: { ...process.env, CODEINK_FIXTURE_RECORD: log },
      model: "acp-two",
      variant: "high",
      remoteID,
      emit: (e) => events.push(e),
    })
  const adapter = make()
  cleanup.push(async () => {
    adapter.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  await adapter.prompt("hello", [{ id: crypto.randomUUID(), filename: "image.png", mime: "image/png", path: image }])
  await eventually(() => events.some((e) => e.type === "approval"))
  expect(events.some((e) => e.type === "error")).toBe(false)
  expect(events.find((e) => e.type === "tool")).toMatchObject({
    tool: { name: "bash", input: { command: "ls -la" }, status: "running" },
  })
  await adapter.answer("900", { allow: true })
  await eventually(() => events.some((e) => e.type === "done"))
  expect(events.filter((e) => e.type === "tool").at(-1)).toMatchObject({
    tool: { name: "bash", input: { command: "ls -la" }, status: "completed", output: "README.md" },
  })
  const textEvents = events.filter((event) => event.type === "text")
  expect(textEvents).toHaveLength(2)
  expect(textEvents[0].id).not.toBe(textEvents[1].id)
  expect(events.find((event) => event.type === "usage")).toMatchObject({
    usage: { contextUsed: 1250, contextLimit: 10000 },
    sessionCost: 0.03,
  })
  adapter.configure?.("acp-one", "low")
  events.length = 0
  await adapter.prompt("", [{ id: crypto.randomUUID(), filename: "image.png", mime: "image/png", path: image }])
  await eventually(() => events.some((e) => e.type === "approval"))
  await adapter.answer("900", { allow: false })
  await eventually(() => events.some((e) => e.type === "done"))
  adapter.dispose()
  events.length = 0
  const resumed = make("native-session")
  cleanup.unshift(() => resumed.dispose())
  await resumed.prompt("resume")
  await eventually(() => events.some((e) => e.type === "approval"))
  expect(events.filter((e) => e.type === "text").some((e) => e.text.includes("Previously replayed"))).toBe(false)
  await resumed.stop()
  const records = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((s) => object(JSON.parse(s)))
  expect(records.filter((r) => r.method === "session/new")).toHaveLength(1)
  expect((object(records.find((r) => r.method === "session/prompt")?.params).prompt as unknown[])[1]).toMatchObject({ type: "image", mimeType: "image/png", data: (await readFile(image)).toString("base64") })
  expect((object(records.filter((r) => r.method === "session/prompt")[1]?.params).prompt as unknown[])[0]).toMatchObject({ type: "image", mimeType: "image/png" })
  expect(records.some((r) => r.method === "session/load")).toBe(true)
  expect(records.filter((r) => r.method === "session/set_config_option").map((r) => r.params)).toContainEqual({
    sessionId: "native-session",
    configId: "model",
    value: "acp-two",
  })
  expect(records.some((r) => object(object(r.result).outcome).optionId === "once")).toBe(true)
  expect(records.some((r) => object(object(r.result).outcome).optionId === "always")).toBe(false)
})
test("ACP reports unsupported resume instead of silently losing native history", async () => {
  const adapter = connectAgent({
    agent,
    executable: process.execPath,
    directory: tmpdir(),
    env: { ...process.env, CODEINK_FIXTURE_NO_RESUME: "1" },
    model: "",
    remoteID: "native-session",
    emit: () => {},
  })
  cleanup.push(() => adapter.dispose())
  await expect(adapter.prompt("hello")).rejects.toThrow("cannot resume")
})
test("new presets appear for existing users without overwriting customized executable settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-presets-"))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const store = new WorkspaceStore(join(directory, "state.json"))
  store.state.agents = [{ ...defaults[0], command: "/custom/codex", args: ["--custom"] }]
  await store.save()
  const restored = new WorkspaceStore(join(directory, "state.json"))
  await restored.load()
  expect(restored.state.agents[0].command).toBe("/custom/codex")
  expect(restored.state.agents.filter((a) => a.protocol === "acp")).toHaveLength(22)
  expect(new Set(restored.state.agents.map((a) => a.id)).size).toBe(restored.state.agents.length)
})
