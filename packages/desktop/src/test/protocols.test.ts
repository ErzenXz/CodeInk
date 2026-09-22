import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { connectAgent, resolveExecutable } from "../main/agents"
import { JsonLines } from "../main/adapters/process"
import type { Adapter } from "../main/adapters/types"
import { array, object } from "../main/adapters/types"
import type { AgentEvent, Protocol } from "../shared/types"

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
    // Windows holds the child process's working directory until taskkill finishes.
    cleanup.push(() => rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }))
    const events: AgentEvent[] = []
    const log = join(directory, "requests.jsonl")
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
        model,
        variant: protocol === "pi" ? undefined : "high",
        remoteID,
        emit: (event) => events.push(event),
      })
    const adapter = make()
    cleanup.push(() => adapter.dispose())
    await adapter.prompt("hello")
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
      })
    }
    if (protocol === "claude" || protocol === "pi") {
      const args = array(records[0].argv)
      expect(args[args.indexOf("--model") + 1]).toBe(model)
      if (protocol === "claude") expect(args[args.indexOf("--effort") + 1]).toBe("high")
    }
    if (protocol === "opencode") {
      expect(records.find((item) => item.body)?.body).toMatchObject({
        model: { providerID: "fixture-provider", modelID: "model/one" },
        variant: "high",
      })
    }
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
    model: "",
    emit: () => {},
  })
  cleanup.push(() => adapter.dispose())
  await expect(adapter.prompt("fail")).rejects.toThrow("Fixture rejection")
})
