import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { connectAgent, resolveExecutable } from "../main/agents"
import { JsonLines } from "../main/adapters/process"
import type { Adapter } from "../main/adapters/types"
import { array, object } from "../main/adapters/types"
import type { AgentEvent, Protocol } from "../shared/types"
import { removeFixture } from "./fixtures/cleanup"

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})
const fixture = join(import.meta.dirname, "fixtures/agent.ts")

export async function eventually(check: () => boolean, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Condition did not settle")
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
}

test("JSONL preserves split UTF-8, CRLF and Unicode line separators", () => {
  const input = Buffer.from('{"text":"🌍\u2028hello"}\r\n{"id":2}\n')
  const parser = new JsonLines()
  const messages: unknown[] = []
  for (const byte of input) parser.push(Buffer.from([byte]), (message) => messages.push(message))
  expect(messages).toEqual([{ text: "🌍\u2028hello" }, { id: 2 }])
})
test("JSONL rejects invalid protocol output", () => {
  expect(() => new JsonLines().push(Buffer.from("not json\n"), () => {})).toThrow()
})
test("discovery never resolves an executable from a relative PATH entry", async () => {
  expect(await resolveExecutable("package.json", { PATH: "." })).toBeUndefined()
  expect(await resolveExecutable(process.execPath, {})).toBe(process.execPath)
})

for (const protocol of ["codex", "claude", "opencode", "pi"] as const) {
  test(`${protocol}: real subprocess streams, requests approval, completes and resumes`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "codeink-protocol-"))
    cleanup.push(() => removeFixture(directory))
    const events: AgentEvent[] = []
    const log = join(directory, "requests.jsonl")
    const image = join(directory, "image.png")
    await writeFile(image, await readFile(join(import.meta.dirname, "../../icons/codeink/32x32.png")))
    const model =
      protocol === "codex"
        ? "fixture-model-two"
        : protocol === "claude"
          ? "fixture-claude-two"
          : protocol === "pi"
            ? "fixture-provider/pi-two"
            : "fixture-provider/model/one"
    const make = (remoteID?: string): Adapter =>
      connectAgent({
        agent: { id: protocol, name: protocol, protocol, command: process.execPath, args: [fixture, protocol] },
        executable: process.execPath,
        directory,
        env: { ...process.env, CODEINK_FIXTURE_RECORD: log },
        rules: () => ({ access: "ask" as const, fast: false }),
        model,
        variant: protocol === "pi" ? undefined : "high",
        remoteID,
        emit: (event) => events.push(event),
      })
    const adapter = make()
    cleanup.push(() => adapter.dispose())
    await adapter.prompt("hello", [{ id: crypto.randomUUID(), filename: "image.png", mime: "image/png", path: image }])
    await eventually(() => events.some((event) => event.type === "approval"))
    expect(events.filter((event) => event.type === "error")).toEqual([])
    const approval = events.find((event) => event.type === "approval")!
    expect(approval.type).toBe("approval")
    if (approval.type !== "approval") throw new Error("Missing approval")
    await adapter.answer(approval.approval.id, { allow: false })
    await eventually(() => events.some((event) => event.type === "done"))
    expect(events.filter((event) => event.type === "tool").at(-1)).toMatchObject({
      tool: { name: "bash", input: { command: "ls -la" }, status: "completed", output: "README.md" },
    })
    expect(events.filter((event) => event.type === "text").some((event) => event.text.includes("🌍\u2028"))).toBe(true)
    expect(events.filter((event) => event.type === "text").some((event) => event.text === "hello")).toBe(false)
    const native = events.find((event) => event.type === "session")
    expect(native).toEqual({ type: "session", id: "native-session" })
    const records = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => object(JSON.parse(line)))
    if (protocol === "codex") {
      expect(object(records.find((item) => item.method === "thread/start")?.params).model).toBe(model)
      expect(object(records.find((item) => item.method === "turn/start")?.params)).toMatchObject({
        model,
        effort: "high",
        input: [{ type: "text", text: "hello" }, { type: "localImage", path: image }],
      })
    }
    if (protocol === "claude") {
      const content = array(object(records.find((item) => item.type === "user")?.message).content)
      expect(content).toMatchObject([{ type: "text", text: "hello" }, { type: "image", source: { type: "base64", media_type: "image/png" } }])
      expect(String(object(content[1]).source && object(object(content[1]).source).data)).toBe((await readFile(image)).toString("base64"))
    }
    if (protocol === "pi") expect(array(records.find((item) => item.type === "prompt")?.images)[0]).toMatchObject({ type: "image", mimeType: "image/png", data: (await readFile(image)).toString("base64") })
    if (protocol === "claude" || protocol === "pi") {
      const args = array(records[0].argv)
      expect(args[args.indexOf("--model") + 1]).toBe(model)
      if (protocol === "claude") expect(args[args.indexOf("--effort") + 1]).toBe("high")
    }
    if (protocol === "opencode") {
      expect(records.find((item) => item.body)?.body).toMatchObject({
        model: { providerID: "fixture-provider", modelID: "model/one" },
        agent: "build",
        variant: "high",
      })
      expect(array(object(records.find((item) => item.body)?.body).parts)[1]).toMatchObject({ type: "file", mime: "image/png", filename: "image.png", url: `data:image/png;base64,${(await readFile(image)).toString("base64")}` })
    }
    events.length = 0
    await adapter.prompt("", [{ id: crypto.randomUUID(), filename: "image.png", mime: "image/png", path: image }])
    await eventually(() => events.some((event) => event.type === "approval"))
    const imageOnly = (await readFile(log, "utf8")).trim().split("\n").map((line) => object(JSON.parse(line)))
    if (protocol === "codex") expect(array(object(imageOnly.findLast((item) => item.method === "turn/start")?.params).input)[0]).toMatchObject({ type: "localImage", path: image })
    if (protocol === "claude") expect(array(object(imageOnly.findLast((item) => item.type === "user")?.message).content)[0]).toMatchObject({ type: "image" })
    if (protocol === "opencode") expect(array(object(imageOnly.findLast((item) => item.body)?.body).parts)[0]).toMatchObject({ type: "file", mime: "image/png" })
    if (protocol === "pi") expect(imageOnly.findLast((item) => item.type === "prompt")?.message).toBe("")
    const second = events.find((event) => event.type === "approval")
    if (second?.type !== "approval") throw new Error("Missing image-only approval")
    await adapter.answer(second.approval.id, { allow: false })
    await eventually(() => events.some((event) => event.type === "done"))
    adapter.dispose()
    events.length = 0
    const resumed = make("native-session")
    cleanup.push(() => resumed.dispose())
    await resumed.prompt("continue")
    await eventually(() => events.some((event) => event.type === "approval"))
    expect(events.filter((event) => event.type === "error")).toEqual([])
    await resumed.stop()
  }, 15000)
}

test("Pi command rejection fails the turn immediately", async () => {
  const adapter = connectAgent({
    agent: { id: "pi", name: "Pi", protocol: "pi" as Protocol, command: process.execPath, args: [fixture, "pi"] },
    executable: process.execPath,
    directory: tmpdir(),
    env: process.env,
    rules: () => ({ access: "ask" as const, fast: false }),
    model: "",
    emit: () => {},
  })
  cleanup.push(() => adapter.dispose())
  await expect(adapter.prompt("fail")).rejects.toThrow("Fixture rejection")
})

for (const protocol of ["codex", "claude", "opencode"] as const) {
  test(`${protocol} uses its native plan mode`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "codeink-plan-"))
    const log = join(directory, "requests.jsonl")
    cleanup.push(() => removeFixture(directory))
    const events: AgentEvent[] = []
    const adapter = connectAgent({
      agent: { id: protocol, name: protocol, protocol, command: process.execPath, args: [fixture, protocol] },
      executable: process.execPath, directory,
      env: { ...process.env, CODEINK_FIXTURE_RECORD: log },
      rules: () => ({ access: "plan", fast: false }),
      model: protocol === "codex" ? "fixture-model-two" : protocol === "claude" ? "fixture-claude-two" : "fixture-provider/model/one",
      emit: (event) => events.push(event),
    })
    cleanup.push(() => adapter.dispose())
    await adapter.prompt("Plan this")
    await eventually(() => events.some((event) => event.type === "approval"))
    const records = (await readFile(log, "utf8")).trim().split("\n").map((line) => object(JSON.parse(line)))
    if (protocol === "codex") expect(object(records.find((item) => item.method === "turn/start")?.params)).toMatchObject({
      collaborationMode: { mode: "plan", settings: { model: "fixture-model-two" } },
      sandboxPolicy: { type: "readOnly" },
    })
    if (protocol === "claude") {
      const args = array(records[0].argv)
      expect(args[args.indexOf("--permission-mode") + 1]).toBe("plan")
    }
    if (protocol === "opencode") expect(object(records.find((item) => item.body)?.body).agent).toBe("plan")
  })
}
