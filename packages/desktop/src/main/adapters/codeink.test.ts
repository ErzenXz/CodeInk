import { afterEach, expect, test } from "bun:test"
import { createServer } from "node:http"
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { codeink } from "./codeink"
import { gatewayModels } from "./model-discovery"
import { GatewayKeyStore } from "../gateway-keys"
import type { AgentEvent } from "../../shared/types"

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})

test("gateway keys stay in a private file and status does not expose them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-gateway-"))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, "gateway-keys.json")
  const store = new GatewayKeyStore(path)
  expect(await store.set("vercel", "secret-test-key")).toEqual({ vercel: true, openrouter: false })
  expect((await stat(path)).mode & 0o777).toBe(0o600)
  const loaded = new GatewayKeyStore(path)
  await loaded.load()
  expect(loaded.get("vercel")).toBe("secret-test-key")
  expect(loaded.status()).toEqual({ vercel: true, openrouter: false })
  await Promise.all([loaded.set("vercel", "second-key"), loaded.set("openrouter", "third-key")])
  const concurrent = new GatewayKeyStore(path)
  await concurrent.load()
  expect(concurrent.get("vercel")).toBe("second-key")
  expect(concurrent.get("openrouter")).toBe("third-key")
  expect(await loaded.set("vercel", "")).toEqual({ vercel: false, openrouter: true })
})

test("OpenRouter model discovery omits models that cannot serve coding tools", async () => {
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json")
    response.end(
      JSON.stringify({
        data: [
          {
            id: "coding-model:free",
            supported_parameters: ["tools"],
            architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
          },
          { id: "tool-choice-model:free", supported_parameters: ["tool_choice"] },
          { id: "text-only-model:free", supported_parameters: ["temperature"] },
          { id: "thinkingmachines/inkling-small:free", supported_parameters: ["tools"] },
        ],
      }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing test server address")
  const endpoint = `http://127.0.0.1:${address.port}`
  const models = await gatewayModels(
    {
      agent: { id: "codeink", name: "CodeInk Agent", protocol: "codeink", command: "builtin", args: [], executable: "builtin" },
      directory: "/tmp",
      env: process.env,
      signal: new AbortController().signal,
      gatewayKey: (provider) => (provider === "openrouter" ? "test-key" : undefined),
    },
    { vercel: endpoint, openrouter: endpoint },
  )
  expect(models.map((model) => model.id)).toEqual([
    "openrouter:coding-model:free",
  ])
  expect(models[0]).toMatchObject({ image: true })
})

test("discovers gateway models and runs a terminal-only turn after approval", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-agent-"))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const requests: Record<string, unknown>[] = []
  const server = createServer(async (request, response) => {
    expect(request.headers.authorization).toBe("Bearer test-key")
    if (request.url === "/models") {
      response.setHeader("Content-Type", "application/json")
      response.end(
        JSON.stringify({
          data: [
            { id: "test-model", name: "Test model", context_length: 128000 },
            { id: "image-model", name: "Image model", architecture: { output_modalities: ["image"] } },
          ],
        }),
      )
      return
    }
    const body = await new Promise<string>((resolve) => {
      const chunks: Buffer[] = []
      request.on("data", (chunk: Buffer) => chunks.push(chunk))
      request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
    })
    const parsed = JSON.parse(body) as Record<string, unknown>
    requests.push(parsed)
    response.setHeader("Content-Type", "text/event-stream")
    const tool = requests.length === 1
    response.end(
      `data: ${JSON.stringify(
        tool
          ? {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call_1",
                        function: { name: "terminal", arguments: JSON.stringify({ command: "pwd" }) },
                      },
                    ],
                  },
                },
              ],
            }
          : { choices: [{ delta: { content: "The command finished." } }] },
      )}\n\n` +
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }] })}\n\n` +
        `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 3 } } })}\n\ndata: [DONE]\n\n`,
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing test server address")
  const endpoint = `http://127.0.0.1:${address.port}`
  const models = await gatewayModels(
    {
      agent: {
        id: "codeink",
        name: "CodeInk Agent",
        protocol: "codeink",
        command: "",
        args: [],
        executable: "builtin",
      },
      directory,
      env: process.env,
      signal: new AbortController().signal,
      gatewayKey: (provider) => (provider === "vercel" ? "test-key" : undefined),
    },
    { vercel: endpoint, openrouter: endpoint },
  )
  expect(models).toMatchObject([{ id: "vercel:test-model", name: "Test model", context: 128000 }])

  const events: AgentEvent[] = []
  const adapter = codeink(
    {
      agent: { id: "codeink", name: "CodeInk Agent", protocol: "codeink", command: "", args: [] },
      executable: "builtin",
      directory,
      env: process.env,
      model: "vercel:test-model",
      gatewayKey: () => "test-key",
      rules: () => ({ access: "ask", fast: false }),
      emit: (event) => events.push(event),
    },
    { vercel: endpoint, openrouter: endpoint },
  )
  cleanup.push(async () => adapter.dispose())
  const turn = adapter.prompt("Where am I?")
  for (let attempt = 0; !events.some((event) => event.type === "approval") && attempt < 100; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10))
  const approval = events.find((event) => event.type === "approval")
  if (approval?.type !== "approval") throw new Error("Missing terminal approval")
  await adapter.answer(approval.approval.id, { allow: true })
  await turn
  expect(requests).toHaveLength(2)
  expect(requests[0]).toMatchObject({ model: "test-model", stream: true, tools: [{ function: { name: "terminal" } }] })
  expect(requests[1]).toMatchObject({
    messages: expect.arrayContaining([
      { role: "tool", tool_call_id: "call_1", content: expect.stringContaining(directory) },
    ]),
  })
  expect(events.some((event) => event.type === "tool" && event.tool?.status === "completed")).toBe(true)
  expect(events.filter((event) => event.type === "usage").at(-1)).toMatchObject({
    usage: { input: 10, output: 4, cacheRead: 6 },
  })
  expect(events.at(-1)).toEqual({ type: "done" })
  const imagePath = join(directory, "example.png")
  await writeFile(
    imagePath,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lqsAAAAASUVORK5CYII=",
      "base64",
    ),
  )
  await adapter.prompt("What next?", [{ id: "image-1", filename: "example.png", mime: "image/png", path: imagePath }])
  expect(JSON.stringify(requests[2])).toContain("data:image/png;base64,")
  expect(new Set(events.filter((event) => event.type === "text").map((event) => event.id)).size).toBe(2)

  const planEvents: AgentEvent[] = []
  const plan = codeink(
    {
      agent: { id: "codeink", name: "CodeInk Agent", protocol: "codeink", command: "builtin", args: [] },
      executable: "builtin",
      directory,
      env: process.env,
      model: "vercel:test-model",
      gatewayKey: () => "test-key",
      rules: () => ({ access: "plan", fast: false }),
      emit: (event) => planEvents.push(event),
    },
    { vercel: endpoint, openrouter: endpoint },
  )
  cleanup.push(async () => plan.dispose())
  await plan.prompt("Plan this change")
  expect(requests[3]?.tools).toBeUndefined()
  expect(planEvents.some((event) => event.type === "approval" || event.type === "tool")).toBe(false)
})

test("CodeInk Agent accepts a steer during a streamed reply", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-agent-steer-"))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const requests: Record<string, unknown>[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")))
    response.writeHead(200, { "Content-Type": "text/event-stream" })
    if (requests.length === 1) {
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Starting work." } }] })}\n\n`)
      return
    }
    response.end(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Changed direction." } }] })}\n\n` +
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n` +
        "data: [DONE]\n\n",
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing test server address")
  const events: AgentEvent[] = []
  const endpoint = `http://127.0.0.1:${address.port}`
  const adapter = codeink(
    {
      agent: { id: "codeink", name: "CodeInk Agent", protocol: "codeink", command: "", args: [] },
      executable: "builtin",
      directory,
      env: process.env,
      model: "vercel:test-model",
      gatewayKey: () => "test-key",
      rules: () => ({ access: "plan", fast: false }),
      emit: (event) => events.push(event),
    },
    { vercel: endpoint, openrouter: endpoint },
  )
  cleanup.push(async () => adapter.dispose())
  const turn = adapter.prompt("Original request")
  const deadline = Date.now() + 5000
  while (!events.some((event) => event.type === "text")) {
    if (Date.now() > deadline) throw new Error("First reply did not stream")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  await adapter.steer?.("New priority")
  await turn
  expect(requests).toHaveLength(2)
  expect(JSON.stringify(requests[1])).toContain("New priority")
  expect(events.filter((event) => event.type === "done")).toHaveLength(1)
})

test("OpenRouter turns keep their conversation and a stable cache routing ID", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-agent-context-"))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const requests: { headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push({ headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) })
    response.writeHead(200, { "Content-Type": "text/event-stream" })
    response.end(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Done." } }] })}\n\n` +
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n` +
        "data: [DONE]\n\n",
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing test server address")
  const endpoint = `http://127.0.0.1:${address.port}`
  const adapter = codeink(
    {
      agent: { id: "codeink", name: "CodeInk Agent", protocol: "codeink", command: "builtin", args: [] },
      executable: "builtin",
      directory,
      env: process.env,
      model: "openrouter:test-model",
      remoteID: "persistent-conversation",
      gatewayKey: () => "test-key",
      rules: () => ({ access: "ask", fast: false }),
      emit: () => {},
    },
    { vercel: endpoint, openrouter: endpoint },
  )
  cleanup.push(async () => adapter.dispose())
  for (const message of ["Original requirement", "Second turn", "Third turn", "Fourth turn"])
    await adapter.prompt(message)
  expect(requests).toHaveLength(4)
  expect(requests[3]?.body.messages).toEqual(
    expect.arrayContaining([expect.objectContaining({ role: "user", content: "Original requirement" })]),
  )
  expect(requests.map((request) => request.headers["x-session-id"])).toEqual(
    Array(4).fill("persistent-conversation"),
  )
  expect(requests[0]?.headers["http-referer"]).toBe("https://getcode.ink")
  expect(requests[0]?.headers["x-openrouter-title"]).toBe("CodeInk")
  expect(requests[0]?.body.provider).toEqual({ require_parameters: true })
  expect(JSON.stringify(requests[0]?.body.messages)).toContain("Follow the user's latest request")
})

test("CodeInk Agent recovers from three transient gateway failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-agent-retry-"))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  let requests = 0
  const server = createServer((_request, response) => {
    requests++
    if (requests <= 3) {
      response.writeHead(503, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ error: { message: "Temporary overload" } }))
      return
    }
    response.writeHead(200, { "Content-Type": "text/event-stream" })
    response.end(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Recovered." } }] })}\n\n` +
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n` +
        "data: [DONE]\n\n",
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing test server address")
  const events: AgentEvent[] = []
  const endpoint = `http://127.0.0.1:${address.port}`
  const adapter = codeink(
    {
      agent: { id: "codeink", name: "CodeInk Agent", protocol: "codeink", command: "builtin", args: [] },
      executable: "builtin",
      directory,
      env: process.env,
      model: "openrouter:test-model",
      gatewayKey: () => "test-key",
      rules: () => ({ access: "ask", fast: false }),
      emit: (event) => events.push(event),
    },
    { vercel: endpoint, openrouter: endpoint },
  )
  cleanup.push(async () => adapter.dispose())
  await adapter.prompt("Answer the request")
  expect(requests).toBe(4)
  expect(events.filter((event) => event.type === "text")).toEqual([
    expect.objectContaining({ text: "Recovered." }),
  ])
  expect(events.at(-1)).toEqual({ type: "done" })
}, 15_000)

test("a failed terminal command reports its exit status to the model and UI", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-agent-command-error-"))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const requests: Record<string, unknown>[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")))
    response.writeHead(200, { "Content-Type": "text/event-stream" })
    response.end(
      `data: ${JSON.stringify({ choices: [{ delta: requests.length === 1
        ? { tool_calls: [{ index: 0, id: "call_failed", function: { name: "terminal", arguments: JSON.stringify({ command: "exit 7" }) } }] }
        : { content: "The command failed." } }] })}\n\n` +
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: requests.length === 1 ? "tool_calls" : "stop" }] })}\n\n` +
        "data: [DONE]\n\n",
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing test server address")
  const endpoint = `http://127.0.0.1:${address.port}`
  const events: AgentEvent[] = []
  const adapter = codeink(
    {
      agent: { id: "codeink", name: "CodeInk Agent", protocol: "codeink", command: "builtin", args: [] },
      executable: "builtin",
      directory,
      env: process.env,
      model: "openrouter:test-model",
      gatewayKey: () => "test-key",
      rules: () => ({ access: "full", fast: false }),
      emit: (event) => events.push(event),
    },
    { vercel: endpoint, openrouter: endpoint },
  )
  cleanup.push(async () => adapter.dispose())
  await adapter.prompt("Run a check")
  expect(events.findLast((event) => event.type === "tool")).toMatchObject({
    tool: { status: "error", error: expect.stringContaining("7") },
  })
  const toolMessage = (requests[1]?.messages as { role: string; content: string }[]).find(
    (message) => message.role === "tool",
  )
  expect(JSON.parse(toolMessage?.content ?? "{}")).toMatchObject({ exitCode: 7, timedOut: false })
  expect(events.at(-1)).toEqual({ type: "done" })
})

test("a permanent gateway rejection is not retried", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-agent-rejected-"))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  let requests = 0
  const server = createServer((_request, response) => {
    requests++
    response.writeHead(403, { "Content-Type": "application/json" })
    response.end(JSON.stringify({ error: { message: "Model is restricted" } }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing test server address")
  const endpoint = `http://127.0.0.1:${address.port}`
  const adapter = codeink(
    {
      agent: { id: "codeink", name: "CodeInk Agent", protocol: "codeink", command: "builtin", args: [] },
      executable: "builtin",
      directory,
      env: process.env,
      model: "openrouter:test-model",
      gatewayKey: () => "test-key",
      rules: () => ({ access: "ask", fast: false }),
      emit: () => {},
    },
    { vercel: endpoint, openrouter: endpoint },
  )
  cleanup.push(async () => adapter.dispose())
  await expect(adapter.prompt("Try the model")).rejects.toThrow("Model is restricted")
  expect(requests).toBe(1)
})

test("invalid terminal input appears as a failed tool call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-agent-invalid-tool-"))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  let requests = 0
  const server = createServer((_request, response) => {
    requests++
    response.writeHead(200, { "Content-Type": "text/event-stream" })
    response.end(
      `data: ${JSON.stringify({ choices: [{ delta: requests === 1
        ? { tool_calls: [{ index: 0, id: "call_invalid", function: { name: "terminal", arguments: "{}" } }] }
        : { content: "The call was invalid." } }] })}\n\n` +
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: requests === 1 ? "tool_calls" : "stop" }] })}\n\n` +
        "data: [DONE]\n\n",
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing test server address")
  const endpoint = `http://127.0.0.1:${address.port}`
  const events: AgentEvent[] = []
  const adapter = codeink(
    {
      agent: { id: "codeink", name: "CodeInk Agent", protocol: "codeink", command: "builtin", args: [] },
      executable: "builtin",
      directory,
      env: process.env,
      model: "openrouter:test-model",
      gatewayKey: () => "test-key",
      rules: () => ({ access: "full", fast: false }),
      emit: (event) => events.push(event),
    },
    { vercel: endpoint, openrouter: endpoint },
  )
  cleanup.push(async () => adapter.dispose())
  await adapter.prompt("Run a command")
  expect(events).toContainEqual(
    expect.objectContaining({ type: "tool", id: "call_invalid", tool: expect.objectContaining({ status: "error" }) }),
  )
})

test("stopping a terminal command ends the active turn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-agent-stop-"))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" })
    response.end(
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_sleep", function: { name: "terminal", arguments: JSON.stringify({ command: "sleep 30" }) } }] } }] })}\n\n` +
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n` +
        "data: [DONE]\n\n",
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing test server address")
  const endpoint = `http://127.0.0.1:${address.port}`
  const events: AgentEvent[] = []
  const adapter = codeink(
    {
      agent: { id: "codeink", name: "CodeInk Agent", protocol: "codeink", command: "builtin", args: [] },
      executable: "builtin",
      directory,
      env: process.env,
      model: "openrouter:test-model",
      gatewayKey: () => "test-key",
      rules: () => ({ access: "full", fast: false }),
      emit: (event) => events.push(event),
    },
    { vercel: endpoint, openrouter: endpoint },
  )
  cleanup.push(async () => adapter.dispose())
  const turn = adapter.prompt("Run a long check")
  const deadline = Date.now() + 3000
  while (!events.some((event) => event.type === "tool" && event.tool?.status === "running")) {
    if (Date.now() > deadline) throw new Error("Terminal command did not start")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  await adapter.stop()
  await Promise.race([
    turn,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Terminal did not stop")), 3000)),
  ])
}, 10_000)

test("steering during a tool batch skips commands that have not started", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-agent-tool-steer-"))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const requests: Record<string, unknown>[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")))
    response.writeHead(200, { "Content-Type": "text/event-stream" })
    response.end(
      `data: ${JSON.stringify({ choices: [{ delta: requests.length === 1
        ? { tool_calls: [
            { index: 0, id: "call_first", function: { name: "terminal", arguments: JSON.stringify({ command: "sleep 0.4" }) } },
            { index: 1, id: "call_second", function: { name: "terminal", arguments: JSON.stringify({ command: "touch should-not-run" }) } },
          ] }
        : { content: "Steer received." } }] })}\n\n` +
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: requests.length === 1 ? "tool_calls" : "stop" }] })}\n\n` +
        "data: [DONE]\n\n",
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing test server address")
  const events: AgentEvent[] = []
  const endpoint = `http://127.0.0.1:${address.port}`
  const adapter = codeink(
    {
      agent: { id: "codeink", name: "CodeInk Agent", protocol: "codeink", command: "builtin", args: [] },
      executable: "builtin",
      directory,
      env: process.env,
      model: "openrouter:test-model",
      gatewayKey: () => "test-key",
      rules: () => ({ access: "full", fast: false }),
      emit: (event) => events.push(event),
    },
    { vercel: endpoint, openrouter: endpoint },
  )
  cleanup.push(async () => adapter.dispose())
  const turn = adapter.prompt("Run both commands")
  const deadline = Date.now() + 3000
  while (!events.some((event) => event.type === "tool" && event.id === "call_first" && event.tool?.status === "running")) {
    if (Date.now() > deadline) throw new Error("First command did not start")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  await adapter.steer?.("Skip remaining commands")
  await turn
  expect(requests).toHaveLength(2)
  expect(await Bun.file(join(directory, "should-not-run")).exists()).toBe(false)
  expect(events.findLast((event) => event.type === "tool" && event.id === "call_second")).toMatchObject({
    tool: { status: "error" },
  })
  await adapter.prompt("What happened next?")
  const messages = requests[2]?.messages as { role: string; content?: string }[]
  const toolIndex = messages.findIndex((message) => message.role === "tool")
  const steerIndex = messages.findIndex((message) => message.role === "user" && message.content === "Skip remaining commands")
  const replyIndex = messages.findIndex((message) => message.role === "assistant" && message.content === "Steer received.")
  expect(toolIndex).toBeGreaterThan(-1)
  expect(steerIndex).toBeGreaterThan(toolIndex)
  expect(replyIndex).toBeGreaterThan(steerIndex)
})

test("steering while approval is pending cancels the command and continues", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-agent-approval-steer-"))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const requests: Record<string, unknown>[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")))
    response.writeHead(200, { "Content-Type": "text/event-stream" })
    response.end(
      `data: ${JSON.stringify({ choices: [{ delta: requests.length === 1
        ? { tool_calls: [{ index: 0, id: "call_pending", function: { name: "terminal", arguments: JSON.stringify({ command: "touch should-not-run" }) } }] }
        : { content: "I stopped the command." } }] })}\n\n` +
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: requests.length === 1 ? "tool_calls" : "stop" }] })}\n\n` +
        "data: [DONE]\n\n",
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing test server address")
  const events: AgentEvent[] = []
  const endpoint = `http://127.0.0.1:${address.port}`
  const adapter = codeink(
    {
      agent: { id: "codeink", name: "CodeInk Agent", protocol: "codeink", command: "builtin", args: [] },
      executable: "builtin",
      directory,
      env: process.env,
      model: "openrouter:test-model",
      gatewayKey: () => "test-key",
      rules: () => ({ access: "ask", fast: false }),
      emit: (event) => events.push(event),
    },
    { vercel: endpoint, openrouter: endpoint },
  )
  cleanup.push(async () => adapter.dispose())
  const turn = adapter.prompt("Run the command")
  const deadline = Date.now() + 3000
  while (!events.some((event) => event.type === "approval")) {
    if (Date.now() > deadline) throw new Error("Approval did not appear")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  await adapter.steer?.("Do not run it")
  await Promise.race([
    turn,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Steer stayed blocked on approval")), 1500)),
  ])
  expect(requests).toHaveLength(2)
  expect(JSON.stringify(requests[1])).toContain("Do not run it")
  expect(await Bun.file(join(directory, "should-not-run")).exists()).toBe(false)
  expect(events).toContainEqual({ type: "approval-resolved", id: "call_pending" })
})

test("in-flight tool output trims old whole turns before the next model request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-agent-context-trim-"))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const requests: Record<string, unknown>[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")))
    response.writeHead(200, { "Content-Type": "text/event-stream" })
    response.end(
      `data: ${JSON.stringify({ choices: [{ delta: requests.length === 1
        ? { tool_calls: [{ index: 0, id: "call_large", function: { name: "terminal", arguments: JSON.stringify({ command: "bun -e \"process.stdout.write('x'.repeat(16000))\"" }) } }] }
        : { content: "Done." } }] })}\n\n` +
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: requests.length === 1 ? "tool_calls" : "stop" }] })}\n\n` +
        "data: [DONE]\n\n",
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing test server address")
  const endpoint = `http://127.0.0.1:${address.port}`
  const adapter = codeink(
    {
      agent: { id: "codeink", name: "CodeInk Agent", protocol: "codeink", command: "builtin", args: [] },
      executable: "builtin",
      directory,
      env: process.env,
      model: "openrouter:test-model",
      history: Array.from({ length: 8 }, (_, index) => [
        { role: "user" as const, text: `OLD-USER-${index} ${"u".repeat(5500)}` },
        { role: "assistant" as const, text: `OLD-REPLY-${index} ${"a".repeat(5500)}` },
      ]).flat(),
      gatewayKey: () => "test-key",
      rules: () => ({ access: "full", fast: false }),
      emit: () => {},
    },
    { vercel: endpoint, openrouter: endpoint },
  )
  cleanup.push(async () => adapter.dispose())
  await adapter.prompt("LATEST-INSTRUCTION")
  expect(requests).toHaveLength(2)
  const messages = requests[1]?.messages as { role: string; content?: string; tool_calls?: { id: string }[]; tool_call_id?: string }[]
  expect(JSON.stringify(requests[0]?.messages).includes("OLD-USER-0")).toBe(true)
  expect(messages.some((message) => message.role === "system")).toBe(true)
  expect(messages.some((message) => message.role === "user" && message.content?.startsWith("OLD-USER-0"))).toBe(false)
  expect(messages.some((message) => message.role === "user" && message.content === "LATEST-INSTRUCTION")).toBe(true)
  expect(messages.some((message) => message.role === "assistant" && message.tool_calls?.some((call) => call.id === "call_large"))).toBe(true)
  expect(messages.some((message) => message.role === "tool" && message.tool_call_id === "call_large")).toBe(true)
})

test("a steer at the turn limit starts a fresh allowance without reusing reply IDs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-agent-turn-reset-"))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const requests: Record<string, unknown>[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")))
    const number = requests.length
    response.writeHead(200, { "Content-Type": "text/event-stream" })
    response.end(
      `data: ${JSON.stringify({ choices: [{ delta: { content: number === 4 ? "Finished." : `Step ${number}.` } }] })}\n\n` +
        (number === 4
          ? ""
          : `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${number}`, function: { name: "terminal", arguments: JSON.stringify({ command: "echo ok" }) } }] } }] })}\n\n`) +
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: number === 4 ? "stop" : "tool_calls" }] })}\n\n` +
        "data: [DONE]\n\n",
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing test server address")
  const endpoint = `http://127.0.0.1:${address.port}`
  const events: AgentEvent[] = []
  const adapter = codeink(
    {
      agent: { id: "codeink", name: "CodeInk Agent", protocol: "codeink", command: "builtin", args: [] },
      executable: "builtin",
      directory,
      env: process.env,
      model: "openrouter:test-model",
      gatewayKey: () => "test-key",
      rules: () => ({ access: "full", fast: false }),
      emit: (event) => {
        events.push(event)
        if (event.type === "tool" && event.id === "call_2" && event.tool?.status === "running")
          void adapter.steer?.("New task at the boundary")
      },
    },
    { vercel: endpoint, openrouter: endpoint },
    2,
  )
  cleanup.push(async () => adapter.dispose())
  await adapter.prompt("Original task")
  expect(requests).toHaveLength(4)
  expect(JSON.stringify(requests[2]?.messages).includes("New task at the boundary")).toBe(true)
  const texts = events.filter((event) => event.type === "text")
  expect(texts).toHaveLength(4)
  expect(new Set(texts.map((event) => event.id)).size).toBe(4)
  expect(events.at(-1)).toEqual({ type: "done" })
  await expect(adapter.prompt("Unsteered task at the limit")).rejects.toThrow(/command limit/)
  expect(requests).toHaveLength(6)
})
