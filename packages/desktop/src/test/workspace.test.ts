import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, symlink, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WorkspaceStore } from "../main/agent-store"
import { Sessions } from "../main/sessions"
import { previewFile, listFiles } from "../main/files"
import { legacyMessages } from "../main/bridge"
import { object } from "../main/adapters/types"

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn()
})
async function eventually(check: () => boolean) {
  const deadline = Date.now() + 5000
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out")
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
}

test("session lifecycle persists remote ID and deduplicated text; concurrent sends and stop are safe", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-workspace-"))
  const path = join(directory, "workspace.json")
  const store = new WorkspaceStore(path)
  store.state.agents = [
    {
      id: "codex",
      name: "Codex",
      protocol: "codex",
      command: process.execPath,
      args: [join(import.meta.dirname, "fixtures/agent.ts"), "codex"],
    },
  ]
  const sessions = new Sessions(store, process.env, () => {})
  cleanup.push(async () => {
    await sessions.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  const input = { agentID: "codex", directory, model: "", text: "hello" }
  const session = await sessions.send(input)
  await eventually(() => sessions.get(session.id).approvals.length > 0)
  await expect(sessions.send({ ...input, sessionID: session.id })).rejects.toThrow("already running")
  await sessions.answer(session.id, "900", { allow: true })
  await eventually(() => sessions.get(session.id).status === "idle")
  expect(
    sessions
      .get(session.id)
      .messages.filter((item) => item.role === "assistant")
      .map((item) => item.text),
  ).toEqual(["Hello 🌍\u2028from your agent"])
  await store.save()
  const restored = new WorkspaceStore(path)
  await restored.load()
  expect(restored.state.sessions[0].remoteID).toBe("native-session")
  const outcomes = await Promise.allSettled([
    sessions.send({ ...input, sessionID: session.id }),
    sessions.send({ ...input, sessionID: session.id }),
  ])
  expect(outcomes.filter((value) => value.status === "fulfilled")).toHaveLength(1)
  await eventually(() => sessions.get(session.id).approvals.length > 0)
  await sessions.stop(session.id)
  expect(sessions.get(session.id).status).toBe("idle")
  expect(sessions.get(session.id).approvals).toEqual([])
  await sessions.archive(session.id)
  expect(store.state.sessions).toEqual([])
})

test("multiple agent sessions complete concurrently and retain separate histories", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-concurrent-"))
  const path = join(directory, "workspace.json")
  const store = new WorkspaceStore(path)
  store.state.agents = [
    {
      id: "codex",
      name: "Codex",
      protocol: "codex",
      command: process.execPath,
      args: [join(import.meta.dirname, "fixtures/agent.ts"), "codex"],
    },
  ]
  const sessions = new Sessions(store, process.env, () => {})
  cleanup.push(async () => {
    await sessions.dispose()
    await rm(directory, { recursive: true, force: true })
  })

  const started = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      sessions.send({ agentID: "codex", directory, model: "", text: `agent ${index}` }),
    ),
  )
  await eventually(() => started.every((session) => sessions.get(session.id).approvals.length > 0))
  expect(started.every((session) => sessions.get(session.id).status === "running")).toBe(true)

  await Promise.all(started.map((session) => sessions.answer(session.id, "900", { allow: true })))
  await eventually(() => started.every((session) => sessions.get(session.id).status === "idle"))
  await sessions.dispose()

  const restored = new WorkspaceStore(path)
  await restored.load()
  expect(restored.state.sessions).toHaveLength(8)
  expect(restored.state.sessions.map((session) => session.messages[0].text).sort()).toEqual(
    Array.from({ length: 8 }, (_, index) => `agent ${index}`).sort(),
  )
  expect(restored.state.sessions.every((session) => session.messages.some((message) => message.role === "assistant"))).toBe(true)
})

test("overlapping workspace saves keep the latest state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-save-"))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, "workspace.json")
  const store = new WorkspaceStore(path)
  const pending = Array.from({ length: 24 }, () => store.save())
  await Promise.resolve()
  store.state.selectedAgent = "pi"
  await Promise.all([...pending, store.save()])

  const restored = new WorkspaceStore(path)
  await restored.load()
  expect(restored.state.selectedAgent).toBe("pi")
})

test("agent process failure becomes a visible session error", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-crash-"))
  const store = new WorkspaceStore(join(directory, "workspace.json"))
  store.state.agents[0].command = process.execPath
  store.state.agents[0].args = [join(import.meta.dirname, "fixtures/agent.ts"), "codex"]
  const sessions = new Sessions(store, process.env, () => {})
  cleanup.push(async () => {
    await sessions.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  const session = await sessions.send({ agentID: "codex", directory, model: "", text: "exit" })
  await eventually(() => sessions.get(session.id).status === "error")
  expect(sessions.get(session.id).messages.at(-1)?.role).toBe("error")
})

test("file preview rejects traversal and symlinks outside a selected project", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-files-"))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const project = join(directory, "project")
  await mkdir(project)
  await writeFile(join(directory, "private.txt"), "private")
  await writeFile(join(project, "readme.txt"), "hello")
  await symlink(join(directory, "private.txt"), join(project, "outside.txt"))
  expect(await previewFile(project, "readme.txt")).toBe("hello")
  await expect(previewFile(project, "../private.txt")).rejects.toThrow("outside")
  await expect(previewFile(project, "outside.txt")).rejects.toThrow("outside")
  expect((await listFiles(project, "")).map((value) => value.name)).toEqual(["readme.txt"])
})

test("corrupt state is reported without overwriting the recovery source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-store-"))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, "workspace.json")
  await writeFile(path, "broken")
  await expect(new WorkspaceStore(path).load()).rejects.toThrow()
  expect(await readFile(path, "utf8")).toBe("broken")
})

test("resuming a process with reused native item IDs preserves every turn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-resume-"))
  const store = new WorkspaceStore(join(directory, "agents.json"))
  store.state.agents[0].command = process.execPath
  store.state.agents[0].args = [join(import.meta.dirname, "fixtures/agent.ts"), "codex"]
  const sessions = new Sessions(store, process.env, () => {})
  cleanup.push(async () => {
    await sessions.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  const input = { agentID: "codex", directory, model: "", text: "First turn" }
  const first = await sessions.send(input)
  await eventually(() => sessions.get(first.id).approvals.length > 0)
  await sessions.answer(first.id, "900", { allow: true })
  await eventually(() => sessions.get(first.id).status === "idle")
  const original = structuredClone(sessions.get(first.id).messages)
  await sessions.stop(first.id)
  await sessions.send({ ...input, sessionID: first.id, text: "Second turn" })
  await eventually(() => sessions.get(first.id).approvals.length > 0)
  await sessions.answer(first.id, "900", { allow: false })
  await eventually(() => sessions.get(first.id).status === "idle")
  const messages = sessions.get(first.id).messages
  expect(messages).toHaveLength(6)
  expect(messages.slice(0, 3)).toEqual(original)
  expect(messages[5].id).not.toBe(messages[2].id)
  expect(messages[5].text).toBe(messages[2].text)
})

test("model and effort changes resume the native conversation and retain each turn's selection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-model-switch-"))
  const path = join(directory, "agents.json")
  const log = join(directory, "requests.jsonl")
  const store = new WorkspaceStore(path)
  store.state.agents[0].command = process.execPath
  store.state.agents[0].args = [join(import.meta.dirname, "fixtures/agent.ts"), "codex"]
  const sessions = new Sessions(store, { ...process.env, CODEINK_FIXTURE_RECORD: log }, () => {})
  cleanup.push(async () => {
    await sessions.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  const input = { agentID: "codex", directory, model: "fixture-model-one", variant: "medium", text: "First turn" }
  const first = await sessions.send(input)
  await eventually(() => sessions.get(first.id).approvals.length > 0)
  await sessions.answer(first.id, "900", { allow: true })
  await eventually(() => sessions.get(first.id).status === "idle")
  await sessions.send({
    ...input,
    sessionID: first.id,
    model: "fixture-model-two",
    variant: "low",
    text: "Second turn",
  })
  await eventually(() => sessions.get(first.id).approvals.length > 0)
  await sessions.answer(first.id, "900", { allow: true })
  await eventually(() => sessions.get(first.id).status === "idle")
  await store.save()
  const restored = new WorkspaceStore(path)
  await restored.load()
  const saved = restored.state.sessions[0]
  expect(saved.remoteID).toBe("native-session")
  expect(saved.model).toBe("fixture-model-two")
  expect(saved.variant).toBe("low")
  const messages = legacyMessages(saved)
  expect(messages).toHaveLength(4)
  expect(messages[0].info).toMatchObject({ model: { modelID: "fixture-model-one", variant: "medium" } })
  expect(messages[1].info).toMatchObject({ modelID: "fixture-model-one" })
  expect(messages[2].info).toMatchObject({ model: { modelID: "fixture-model-two", variant: "low" } })
  expect(messages[3].info).toMatchObject({ modelID: "fixture-model-two" })
  const records = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((line) => object(JSON.parse(line)))
  expect(records.filter((item) => item.method === "thread/start")).toHaveLength(1)
  expect(records.find((item) => item.method === "thread/resume")?.params).toMatchObject({
    threadId: "native-session",
    model: "fixture-model-two",
  })
  expect(records.filter((item) => item.method === "turn/start").at(-1)?.params).toMatchObject({
    model: "fixture-model-two",
    effort: "low",
  })
})
