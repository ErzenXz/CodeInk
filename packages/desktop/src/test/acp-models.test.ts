import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acp, acpModels } from "../main/adapters/acp"
import { object } from "../main/adapters/types"
import type { AgentEvent } from "../shared/types"

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose()
})

async function discover(env: NodeJS.ProcessEnv = {}) {
  const directory = await mkdtemp(join(tmpdir(), "codeink-acp-reasoning-"))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const log = join(directory, "requests.jsonl")
  const models = await acpModels({
    agent: {
      id: "harness",
      name: "Harness fixture",
      protocol: "acp",
      command: process.execPath,
      executable: process.execPath,
      args: [join(import.meta.dirname, "fixtures/agent.ts"), "acp"],
    },
    directory,
    env: { ...process.env, ...env, CODEINK_FIXTURE_RECORD: log },
    signal: AbortSignal.timeout(5000),
  })
  const requests = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((line) => object(JSON.parse(line)))
  expect(requests.some((request) => request.method === "session/prompt")).toBe(false)
  expect(requests.some((request) => request.method === "session/delete")).toBe(true)
  return models
}

for (const legacy of [false, true]) {
  test(`ACP ${legacy ? "legacy" : "config"} model discovery keeps per-model choices without duplicating the picker default`, async () => {
    const models = await discover({
      ...(legacy ? { CODEINK_FIXTURE_ACP_LEGACY: "1" } : {}),
      CODEINK_FIXTURE_ACP_EFFORTS: JSON.stringify({
        "acp-one": ["default", "low", "high"],
        "acp-two": ["default", "medium", "xhigh"],
      }),
    })
    expect(models.map((model) => ({ id: model.id, variants: model.variants, reasoning: model.reasoning }))).toEqual([
      { id: "acp-one", variants: ["low", "high"], reasoning: true },
      { id: "acp-two", variants: ["medium", "xhigh"], reasoning: true },
    ])
    expect(models[0].default).toBe(true)
  })
}

test("ACP default-only models do not claim reasoning; metadata works without an initial thought selector", async () => {
  const models = await discover({
    CODEINK_FIXTURE_ACP_NO_REASONING: "1",
    CODEINK_FIXTURE_ACP_EFFORTS: JSON.stringify({ "acp-one": ["default"], "acp-two": ["default", "high"] }),
  })
  expect(models[0].variants).toEqual([])
  expect(models[0].reasoning).toBe(false)
  expect(models[1].variants).toEqual(["high"])
  expect(models[1].reasoning).toBe(true)
})

test("ACP older agents keep initial thought choices when per-model metadata is absent", async () => {
  const models = await discover()
  expect(models.map((model) => model.variants)).toEqual([["low", "high"], ["low", "high"]])
  expect(models.every((model) => model.reasoning)).toBe(true)
  const legacy = await discover({ CODEINK_FIXTURE_ACP_LEGACY: "1" })
  expect(legacy.map((model) => model.variants)).toEqual([[], []])
  expect(legacy.some((model) => model.reasoning)).toBe(false)
  const withDefault = await discover({ CODEINK_FIXTURE_ACP_DEFAULT_EFFORT: "1" })
  expect(withDefault.map((model) => model.variants)).toEqual([["low", "high"], ["low", "high"]])
})

test("ACP filters malformed per-model efforts without copying another model's capabilities", async () => {
  const models = await discover({
    CODEINK_FIXTURE_ACP_EFFORTS: JSON.stringify({ "acp-one": ["default", "low", "low", null, ""], "acp-two": [] }),
  })
  expect(models[0].variants).toEqual(["low"])
  expect(models[1].variants).toEqual([])
  expect(models[1].reasoning).toBe(false)
})

async function eventually(check: () => boolean) {
  const deadline = Date.now() + 5000
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("ACP turn did not settle")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

for (const defaultEffort of [false, true]) {
  test(`ACP clearing a selected effort ${defaultEffort ? "resets an advertised default" : "preserves older agent behavior"}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "codeink-acp-default-"))
    const log = join(directory, "requests.jsonl")
    const events: AgentEvent[] = []
    const adapter = acp({
      agent: {
        id: "harness",
        name: "Harness fixture",
        protocol: "acp",
        command: process.execPath,
        args: [join(import.meta.dirname, "fixtures/agent.ts"), "acp"],
      },
      executable: process.execPath,
      directory,
      env: {
        ...process.env,
        CODEINK_FIXTURE_RECORD: log,
        ...(defaultEffort ? { CODEINK_FIXTURE_ACP_DEFAULT_EFFORT: "1" } : {}),
      },
      model: "acp-one",
      variant: "high",
      rules: () => ({ access: "ask", fast: false }),
      emit: (event) => events.push(event),
    })
    cleanup.push(async () => {
      adapter.dispose()
      await rm(directory, { recursive: true, force: true })
    })
    for (const turn of [1, 2]) {
      if (turn === 2) adapter.configure?.("acp-one", undefined)
      await adapter.prompt(`turn ${turn}`)
      await eventually(() => events.filter((event) => event.type === "approval").length === turn)
      await adapter.answer("900", { allow: false })
      await eventually(() => events.filter((event) => event.type === "done").length === turn)
    }
    expect(events.some((event) => event.type === "error")).toBe(false)
    const requests = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => object(JSON.parse(line)))
    expect(requests.filter((request) => request.method === "session/new")).toHaveLength(1)
    expect(requests.filter((request) => request.acpEffort).map((request) => request.acpEffort)).toEqual([
      "high",
      defaultEffort ? "default" : "high",
    ])
    expect(
      requests
        .filter((request) => request.method === "session/set_config_option")
        .map((request) => object(request.params).value),
    ).toEqual(defaultEffort ? ["high", "default"] : ["high"])
  })
}
