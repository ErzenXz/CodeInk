import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WorkspaceStore } from "../main/agent-store"
import { legacySession, startBridge } from "../main/bridge"
import { sessionSummary } from "../main/session-summary"
import { t } from "../shared/i18n"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "codeink-history-"))
  directories.push(directory)
  const path = join(directory, "agents.json")
  const store = new WorkspaceStore(path)
  store.state.sessions = Array.from({ length: 12 }, (_, index) => ({
    id: `session-${index}`,
    agentID: "codex",
    directory,
    title: `Chat ${index}`,
    model: "default",
    updatedAt: index,
    status: "idle" as const,
    approvals: [],
    messages: [{ id: `user-${index}`, role: "user" as const, text: "x".repeat(100_000), costs: { turn: index } }],
  }))
  return { directory, path, store }
}

test("saving and listing many chats keeps transcripts out of the workspace index", async () => {
  const f = await fixture()
  await f.store.save()
  const source = await readFile(f.path, "utf8")
  expect(source.length).toBeLessThan(20_000)
  expect(JSON.parse(source).sessions.every((session: { messages?: unknown }) => session.messages === undefined)).toBe(
    true,
  )
  const restored = new WorkspaceStore(f.path)
  await restored.load()
  const bridge = await startBridge("127.0.0.1", 0, "password", f.directory, process.env)
  try {
    expect(restored.state.sessions.map(legacySession).map((session) => session.cost)).toEqual(
      Array.from({ length: 12 }, (_, index) => index),
    )
    // A sidebar/bootstrap request must not need the history files at all.
    await rm(f.path + ".history", { recursive: true })
    const address = bridge.server.address()
    if (!address || typeof address === "string") throw new Error("Missing listener")
    const response = await fetch(`http://127.0.0.1:${address.port}/session`, {
      headers: { Authorization: `Basic ${Buffer.from("opencode:password").toString("base64")}` },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toHaveLength(12)
  } finally {
    await bridge.stop()
  }
})

test("legacy migration keeps an exact recovery copy and preserves interrupted histories", async () => {
  const f = await fixture()
  f.store.state.sessions[0].status = "running"
  const source = JSON.stringify(f.store.state)
  await writeFile(f.path, source)
  const restored = new WorkspaceStore(f.path)
  await restored.load()
  await restored.save()
  expect(await readFile(f.path + ".legacy", "utf8")).toBe(source)
  const reopened = new WorkspaceStore(f.path)
  await reopened.load()
  expect(reopened.state.sessions[0].status).toBe("idle")
  expect(reopened.state.sessions[0].messages.at(-1)?.role).toBe("error")
  expect(reopened.state.sessions[1].messages).toEqual(f.store.state.sessions[1].messages)
})

test("editing one chat preserves cold histories across overlapping saves", async () => {
  const f = await fixture()
  await f.store.save()
  const restored = new WorkspaceStore(f.path)
  await restored.load()
  const first = restored.state.sessions[0]
  first.messages.push({ id: "reply", role: "assistant", text: "First reply" })
  const saving = restored.save()
  await Promise.resolve()
  first.messages.at(-1)!.text = "Latest reply"
  restored.state.sessions[1].title = "Renamed cold chat"
  await Promise.all([saving, restored.save()])
  const reopened = new WorkspaceStore(f.path)
  await reopened.load()
  expect(reopened.state.sessions[0].messages.at(-1)?.text).toBe("Latest reply")
  expect(reopened.state.sessions[1].title).toBe("Renamed cold chat")
  expect(reopened.state.sessions[11].messages).toEqual(f.store.state.sessions[11].messages)
  expect((await readdir(f.path + ".history")).filter((name) => name.endsWith(".json"))).toHaveLength(12)
})

test("a failed index commit retains the previous readable histories", async () => {
  const f = await fixture()
  await f.store.save()
  const original = await readFile(f.path, "utf8")
  f.store.state.sessions[0].messages.push({ id: "reply", role: "assistant", text: "Unsaved reply" })
  const { mkdir } = await import("node:fs/promises")
  await mkdir(f.path + ".tmp")
  await expect(f.store.save()).rejects.toThrow()
  expect(await readFile(f.path, "utf8")).toBe(original)
  expect(await readdir(f.path + ".history")).toHaveLength(12)
  const restored = new WorkspaceStore(f.path)
  await restored.load()
  expect(restored.state.sessions[0].messages).toHaveLength(1)
  await rm(f.path + ".tmp", { recursive: true })
  await f.store.save()
  const retried = new WorkspaceStore(f.path)
  await retried.load()
  expect(retried.state.sessions[0].messages.at(-1)?.text).toBe("Unsaved reply")
})

test("history cache evicts clean idle chats while preserving dirty and running chats", async () => {
  const f = await fixture()
  await f.store.save()
  const restored = new WorkspaceStore(f.path)
  await restored.load()
  restored.state.sessions[0].messages.push({ id: "dirty", role: "assistant", text: "Unsaved" })
  restored.state.sessions[1].status = "running"
  const running = restored.state.sessions[1].messages
  const clean = restored.state.sessions[2].messages
  restored.state.sessions.slice(3).forEach((session) => {
    expect(session.messages).toHaveLength(1)
  })
  expect(restored.state.sessions[0].messages.at(-1)?.text).toBe("Unsaved")
  expect(restored.state.sessions[1].messages).toBe(running)
  expect(restored.state.sessions[2].messages).not.toBe(clean)
  await restored.save()
  const reopened = new WorkspaceStore(f.path)
  await reopened.load()
  expect(reopened.state.sessions[0].messages.at(-1)?.text).toBe("Unsaved")
})

test("schema field ordering does not prevent clean native histories from being evicted", async () => {
  const f = await fixture()
  f.store.state.sessions.forEach((session, index) => {
    session.messages = [{ id: `native-${index}`, createdAt: index, role: "assistant", text: "Native output" }]
  })
  await f.store.save()
  const restored = new WorkspaceStore(f.path)
  await restored.load()
  const first = restored.state.sessions[0].messages
  restored.state.sessions.slice(1).forEach((session) => {
    expect(session.messages[0].text).toBe("Native output")
  })
  expect(restored.state.sessions[0].messages).not.toBe(first)
})

test("usage and attachments stay available without loading cold transcripts", async () => {
  const f = await fixture()
  f.store.state.sessions[0].messages[0].usage = { input: 10, cacheRead: 2, output: 4, reasoning: 1 }
  f.store.state.sessions[0].messages[0].attachments = [
    {
      id: "86ba4210-1f2c-4d30-8755-9d01a1083ad2",
      filename: "image.png",
      mime: "image/png",
    },
  ]
  await f.store.save()
  const restored = new WorkspaceStore(f.path)
  await restored.load()
  await rm(f.path + ".history", { recursive: true })
  expect(sessionSummary(restored.state.sessions[0])).toMatchObject({
    messages: 1,
    input: 12,
    output: 5,
    cacheRead: 2,
    attachments: [{ filename: "image.png" }],
  })
})

test("corrupt or missing transcripts cannot silently become empty histories", async () => {
  const f = await fixture()
  await f.store.save()
  const restored = new WorkspaceStore(f.path)
  await restored.load()
  const index = JSON.parse(await readFile(f.path, "utf8"))
  await writeFile(join(f.path + ".history", index.sessions[0].history.hash + ".json"), "[]")
  expect(() => restored.state.sessions[0].messages).toThrow(t("historyCorrupt"))
  await restored.save()
  expect(await readFile(f.path, "utf8")).toContain(index.sessions[0].history.hash)
  await rm(f.path + ".history", { recursive: true })
  await expect(new WorkspaceStore(f.path).load()).rejects.toThrow()
})
