import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { legacyMessages, startBridge } from "../main/bridge"
import type { Session } from "../shared/types"
import { createOpencodeClient } from "@codeink/sdk/v2/client"

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn()
})

test("active-turn projection matches the full timeline", () => {
  const session: Session = {
    id: "ses_test", agentID: "codex", directory: "/tmp", model: "fixture", title: "test",
    updatedAt: 10, status: "running", approvals: [],
    messages: [
      { id: "old-user", role: "user", text: "Old prompt", createdAt: 1 },
      { id: "old-answer", role: "assistant", text: "Old answer", createdAt: 2 },
      { id: "new-user", role: "user", text: "New prompt", createdAt: 3, mode: "plan" },
      { id: "new-answer", role: "assistant", text: "New answer", createdAt: 4 },
      { id: "new-tool", role: "tool", text: "Result", createdAt: 5, tool: { name: "bash", status: "running" } },
    ],
  }
  const full = legacyMessages(session)
  expect(legacyMessages(session, undefined, 2)).toEqual(full.slice(2))
  expect(legacyMessages(session, undefined, 0, 2)).toEqual(full.slice(0, 2))
  expect(full.at(-1)?.info).toMatchObject({ mode: "plan", agent: "build" })
})

test("conversation pages exclude older tool output and retain complete turns", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-page-"))
  const bridge = await startBridge("127.0.0.1", 0, "test-password", directory, process.env)
  cleanup.push(async () => {
    await bridge.stop()
    await rm(directory, { recursive: true, force: true })
  })
  const address = bridge.server.address()
  if (!address || typeof address === "string") throw new Error("No listener")
  const base = `http://127.0.0.1:${address.port}/session/ses_pages/message`
  const headers = { Authorization: `Basic ${Buffer.from("opencode:test-password").toString("base64")}`, Origin: "codeink://renderer" }
  const session: Session = {
    id: "ses_pages", agentID: "codex", directory, model: "fixture", title: "Pages",
    updatedAt: 10, status: "idle", approvals: [],
    messages: Array.from({ length: 5 }, (_, index) => [
      { id: `user-${index}`, role: "user" as const, text: `Prompt ${index}` },
      { id: `tool-${index}`, role: "tool" as const, text: `Tool output ${index}`, tool: { name: "bash", output: `Tool output ${index}` } },
      { id: `answer-${index}`, role: "assistant" as const, text: `Answer ${index}` },
    ]).flat(),
  }
  bridge.store.state.sessions.push(session)
  const first = await fetch(`${base}?limit=4`, { headers })
  expect(first.ok).toBe(true)
  expect(first.headers.get("Access-Control-Expose-Headers")).toContain("x-next-cursor")
  expect((await first.json()).map((item: { info: { id: string }; parts: { type: string; state?: { output?: string } }[] }) => [item.info.id, item.parts.find((part) => part.type === "tool")?.state?.output])).toEqual([
    ["user-3", undefined], ["user-3a", "Tool output 3"],
    ["user-4", undefined], ["user-4a", "Tool output 4"],
  ])
  const second = await fetch(`${base}?limit=4&before=${first.headers.get("x-next-cursor")}`, { headers })
  expect((await second.json()).map((item: { info: { id: string } }) => item.info.id)).toEqual(["user-1", "user-1a", "user-2", "user-2a"])
  const third = await fetch(`${base}?limit=4&before=${second.headers.get("x-next-cursor")}`, { headers })
  expect((await third.json()).map((item: { info: { id: string } }) => item.info.id)).toEqual(["user-0", "user-0a"])
  expect(third.headers.get("x-next-cursor")).toBeNull()
  expect((await fetch(base, { headers }).then((response) => response.json()))).toHaveLength(10)
  expect((await fetch(`${base}/user-0a`, { headers }).then((response) => response.json())).parts.some((part: { type: string }) => part.type === "tool")).toBe(true)
  bridge.store.state.sessions.push({ ...session, id: "newer-session", updatedAt: 20 })
  expect((await fetch(`${base.replace("/ses_pages/message", "")}?limit=1&directory=${encodeURIComponent(directory)}`, { headers }).then((response) => response.json())).map((item: { id: string }) => item.id)).toEqual(["newer-session"])
  const abort = new AbortController()
  const stream = await fetch(`${base.replace("/session/ses_pages/message", "")}/event?directory=${encodeURIComponent(directory)}`, { headers, signal: abort.signal })
  const reader = stream.body?.getReader()
  if (!reader) throw new Error("No event stream")
  const update = await fetch(`${base.replace("/message", "")}`, {
    method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ title: "Renamed" }),
  })
  expect(update.ok).toBe(true)
  const events: { type: string }[] = []
  let pending = ""
  while (!events.some((item) => item.type === "session.status")) {
    const chunk = await reader.read()
    if (chunk.done) throw new Error("Event stream ended before session status")
    pending += new TextDecoder().decode(chunk.value)
    const complete = pending.split("\n\n")
    pending = complete.pop() ?? ""
    events.push(...complete.filter((item) => item.startsWith("data: ")).map((item) => JSON.parse(item.slice(6))))
  }
  expect(events.filter((item) => item.type.startsWith("message."))).toEqual([])
  session.messages.push(
    { id: "user-5", role: "user", text: "New prompt" },
    { id: "tool-5", role: "tool", text: "New tool output", tool: { name: "bash", output: "New tool output" } },
  )
  session.status = "running"
  session.updatedAt = 30
  await fetch(`${base.replace("/message", "")}`, {
    method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ title: "Running" }),
  })
  const live: { type: string; properties: { info?: { id: string } } }[] = []
  while (!live.some((item) => item.type === "session.status")) {
    const chunk = await reader.read()
    if (chunk.done) throw new Error("Event stream ended before live status")
    pending += new TextDecoder().decode(chunk.value)
    const complete = pending.split("\n\n")
    pending = complete.pop() ?? ""
    live.push(...complete.filter((item) => item.startsWith("data: ")).map((item) => JSON.parse(item.slice(6))))
  }
  abort.abort()
  expect(live.filter((item) => item.type === "message.updated").map((item) => item.properties.info?.id)).toEqual(["user-5", "user-5a"])
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

test("a new agent receives handoff context without adding it to the visible user message", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-handoff-"))
  const log = join(directory, "requests.jsonl")
  const bridge = await startBridge("127.0.0.1", 0, "test-password", directory, { ...process.env, CODEINK_FIXTURE_RECORD: log })
  cleanup.push(async () => {
    await bridge.stop()
    await rm(directory, { recursive: true, force: true })
  })
  const address = bridge.server.address()
  if (!address || typeof address === "string") throw new Error("No listener")
  const client = createOpencodeClient({
    baseUrl: `http://127.0.0.1:${address.port}`,
    headers: { Authorization: `Basic ${Buffer.from("opencode:test-password").toString("base64")}` },
    directory,
    throwOnError: true,
  })
  bridge.store.state.agents = []
  await bridge.saveAgent({ id: "codex", name: "Codex", protocol: "codex", command: process.execPath, args: [join(import.meta.dirname, "fixtures/agent.ts"), "codex"] })
  bridge.store.state.sessions.push({
    id: "source-session", agentID: "claude", directory, title: "Source", model: "claude-model", updatedAt: 1,
    status: "idle", approvals: [], messages: [
      { id: "source-user", role: "user", text: "Keep the tests passing" },
      { id: "source-tool", role: "tool", text: "SECRET_OUTPUT".repeat(1000), tool: { name: "bash", output: "SECRET_OUTPUT".repeat(1000) } },
      { id: "source-answer", role: "assistant", text: "I changed auth.ts and added a test." },
    ],
  })
  const created = await client.session.create({ directory, model: { id: "fixture-model-two", providerID: "local-codex" } })
  if (!created.data) throw new Error("No session")
  expect(bridge.sessions.get(created.data.id)).toMatchObject({ agentID: "codex", model: "fixture-model-two" })
  await client.session.promptAsync({
    sessionID: created.data.id,
    model: { providerID: "local-codex", modelID: "fixture-model-two" },
    system: "codeink-handoff:source-session",
    parts: [{ type: "text", text: "Continue with Codex" }],
  })
  const deadline = Date.now() + 5000
  while (!bridge.sessions.get(created.data.id).approvals.length) {
    if (Date.now() > deadline) throw new Error("Native turn did not start")
    await Bun.sleep(10)
  }
  expect(bridge.sessions.get(created.data.id).messages.find((item) => item.role === "user")?.text).toBe("Continue with Codex")
  const requests = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  const nativePrompt = requests.find((item) => item.method === "turn/start")?.params.input[0].text
  expect(nativePrompt).toContain("source-session (claude)")
  expect(nativePrompt).toContain("Keep the tests passing")
  expect(nativePrompt).toContain("Tools used: bash")
  expect(nativePrompt).toContain("Current request:\nContinue with Codex")
  expect(nativePrompt).not.toContain("SECRET_OUTPUT")
  bridge.store.state.sessions.push({
    id: "other-project", agentID: "claude", directory: "/another-project", title: "Other", model: "", updatedAt: 1,
    status: "idle", approvals: [], messages: [{ id: "private", role: "user", text: "Private context" }],
  })
  const other = await client.session.create({ directory, model: { id: "fixture-model-two", providerID: "local-codex" } })
  if (!other.data) throw new Error("No second session")
  await expect(client.session.promptAsync({
    sessionID: other.data.id,
    model: { providerID: "local-codex", modelID: "fixture-model-two" },
    system: "codeink-handoff:other-project",
    parts: [{ type: "text", text: "Do not cross projects" }],
  })).rejects.toThrow()
  expect(bridge.sessions.get(other.data.id).messages).toHaveLength(0)
})

test("Claude image uploads survive the bridge and reach the native prompt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-image-"))
  const log = join(directory, "requests.jsonl")
  const bridge = await startBridge("127.0.0.1", 0, "test-password", directory, { ...process.env, CODEINK_FIXTURE_RECORD: log })
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
  bridge.store.state.agents = []
  await bridge.saveAgent({ id: "claude", name: "Claude", protocol: "claude", command: process.execPath, args: [join(import.meta.dirname, "fixtures/agent.ts"), "claude"] })
  const sessionResponse = await fetch(`${base}/session?directory=${encodeURIComponent(directory)}`, { method: "POST", headers, body: "{}" })
  expect(sessionResponse.ok).toBe(true)
  const session = await sessionResponse.json()
  const image = (await readFile(join(import.meta.dirname, "../../icons/codeink/32x32.png"))).toString("base64")
  const upload = JSON.stringify({ messageID: "msg_image", model: { providerID: "local-claude", modelID: "default" }, parts: [{ type: "text", text: "What is this?" }, { id: "prt_image", type: "file", mime: "image/png", filename: "pixel.png", url: `data:image/png;base64,${image}` }] })
  const response = await fetch(`${base}/session/${session.id}/prompt_async?directory=${encodeURIComponent(directory)}`, {
    method: "POST", headers,
    body: upload,
  })
  expect(response.status).toBe(200)
  expect((await fetch(`${base}/session/${session.id}/prompt_async?directory=${encodeURIComponent(directory)}`, { method: "POST", headers, body: upload })).status).toBe(200)
  expect(bridge.sessions.get(session.id).messages.filter((message) => message.role === "user")).toHaveLength(1)
  expect((await readFile(join(directory, "agents.json"), "utf8"))).not.toContain(image)
  const deadline = Date.now() + 5000
  while (!bridge.sessions.get(session.id).approvals.length) {
    if (Date.now() > deadline) throw new Error("No approval")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const messages = await fetch(`${base}/session/${session.id}/message?directory=${encodeURIComponent(directory)}`, { headers }).then((response) => response.json())
  const file = messages[0].parts.find((part: { type: string }) => part.type === "file")
  expect(file).toMatchObject({ mime: "image/png", filename: "pixel.png" })
  expect((await fetch(file.url)).status).toBe(200)
  const records = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  expect(records.find((item) => item.type === "user")?.message.content[1]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png", data: image } })
  const selectedSession = await fetch(`${base}/session?directory=${encodeURIComponent(directory)}`, { method: "POST", headers, body: "{}" }).then((response) => response.json())
  const selected = await fetch(`${base}/session/${selectedSession.id}/prompt_async?directory=${encodeURIComponent(directory)}`, {
    method: "POST", headers,
    body: JSON.stringify({ model: { providerID: "local-claude", modelID: "default" }, parts: [{ type: "text", text: "Describe this file" }, { type: "file", mime: "image/png", filename: "icon.png", url: pathToFileURL(join(import.meta.dirname, "../../icons/codeink/32x32.png")).href }] }),
  })
  expect(selected.ok).toBe(true)
  while (!bridge.sessions.get(selectedSession.id).approvals.length) {
    if (Date.now() > deadline) throw new Error("No selected-file approval")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const selectedRecords = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  expect(selectedRecords.filter((item) => item.type === "user").at(-1)?.message.content[1]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/png", data: image } })
})

for (const protocol of ["codex", "claude", "opencode", "pi"] as const) {
  test(`${protocol} questions accept answers through the desktop SDK route`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "codeink-question-"))
    const log = join(directory, "requests.jsonl")
    const bridge = await startBridge("127.0.0.1", 0, "test-password", directory, { ...process.env, CODEINK_FIXTURE_RECORD: log, CODEINK_FIXTURE_QUESTION: "1" })
    cleanup.push(async () => {
      await bridge.stop()
      await rm(directory, { recursive: true, force: true })
    })
    const address = bridge.server.address()
    if (!address || typeof address === "string") throw new Error("No listener")
    const base = `http://127.0.0.1:${address.port}`
    const headers = { Authorization: `Basic ${Buffer.from("opencode:test-password").toString("base64")}`, "Content-Type": "application/json" }
    bridge.store.state.agents = []
    await bridge.saveAgent({ id: protocol, name: protocol, protocol, command: process.execPath, args: [join(import.meta.dirname, "fixtures/agent.ts"), protocol] })
    const session = await fetch(`${base}/session?directory=${encodeURIComponent(directory)}`, { method: "POST", headers, body: "{}" }).then((response) => response.json())
    const prompt = await fetch(`${base}/session/${session.id}/prompt_async?directory=${encodeURIComponent(directory)}`, {
      method: "POST", headers,
      body: JSON.stringify({ model: { providerID: `local-${protocol}`, modelID: "default" }, parts: [{ type: "text", text: "Ask me" }] }),
    })
    expect(prompt.ok).toBe(true)
    const deadline = Date.now() + 5000
    while (!bridge.sessions.get(session.id).approvals.length) {
      if (Date.now() > deadline) throw new Error("No question")
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const questions = await fetch(`${base}/question?directory=${encodeURIComponent(directory)}`, { headers }).then((response) => response.json())
    expect(questions[0].questions[0].question).toBe("Which option?")
    expect(questions[0].questions[0].options.map((item: { label: string }) => item.label)).toEqual(["First", "Second"])
    const reply = await fetch(`${base}/question/${encodeURIComponent(questions[0].id)}/reply?directory=${encodeURIComponent(directory)}`, {
      method: "POST", headers, body: JSON.stringify({ answers: [["Second"]] }),
    })
    expect(reply.ok).toBe(true)
    while (bridge.sessions.get(session.id).status === "running") {
      if (Date.now() > deadline) throw new Error("Question turn did not complete")
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const records = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
    if (protocol === "codex") expect(records.find((item) => item.id === 900)?.result).toEqual({ answers: { choice: { answers: ["Second"] } } })
    if (protocol === "claude") expect(records.find((item) => item.type === "control_response" && item.response.request_id === "permission")?.response.response.updatedInput.answers).toEqual({ "Which option?": "Second" })
    if (protocol === "opencode") expect(records.findLast((item) => item.path === "/question/question/reply")?.body).toEqual({ answers: [["Second"]] })
    if (protocol === "pi") expect(records.find((item) => item.type === "extension_ui_response")?.value).toBe("Second")
  })
}

test("Codex keeps a question available after a nonblocking turn ends", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-async-question-"))
  const log = join(directory, "requests.jsonl")
  const bridge = await startBridge("127.0.0.1", 0, "test-password", directory, {
    ...process.env, CODEINK_FIXTURE_RECORD: log, CODEINK_FIXTURE_QUESTION: "1", CODEINK_FIXTURE_QUESTION_ASYNC: "1",
  })
  cleanup.push(async () => {
    await bridge.stop()
    await rm(directory, { recursive: true, force: true })
  })
  const address = bridge.server.address()
  if (!address || typeof address === "string") throw new Error("No listener")
  const base = `http://127.0.0.1:${address.port}`
  const headers = { Authorization: `Basic ${Buffer.from("opencode:test-password").toString("base64")}`, "Content-Type": "application/json" }
  bridge.store.state.agents = []
  await bridge.saveAgent({ id: "codex", name: "Codex", protocol: "codex", command: process.execPath, args: [join(import.meta.dirname, "fixtures/agent.ts"), "codex"] })
  const session = await fetch(`${base}/session?directory=${encodeURIComponent(directory)}`, { method: "POST", headers, body: "{}" }).then((response) => response.json())
  const prompt = await fetch(`${base}/session/${session.id}/prompt_async?directory=${encodeURIComponent(directory)}`, {
    method: "POST", headers, body: JSON.stringify({ model: { providerID: "local-codex", modelID: "fixture-model-two" }, parts: [{ type: "text", text: "Ask asynchronously" }] }),
  })
  expect(prompt.ok).toBe(true)
  const deadline = Date.now() + 5000
  while (bridge.sessions.get(session.id).status !== "idle" || !bridge.sessions.get(session.id).approvals.length) {
    if (Date.now() > deadline) throw new Error("Question did not survive completion")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const questions = await fetch(`${base}/question?directory=${encodeURIComponent(directory)}`, { headers }).then((response) => response.json())
  expect(questions).toHaveLength(1)
  const reply = await fetch(`${base}/question/${encodeURIComponent(questions[0].id)}/reply?directory=${encodeURIComponent(directory)}`, {
    method: "POST", headers, body: JSON.stringify({ answers: [["First"]] }),
  })
  expect(reply.ok).toBe(true)
  expect((await readFile(log, "utf8")).includes('"First"')).toBe(true)
})
