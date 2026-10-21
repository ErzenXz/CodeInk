import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acpModels } from "../main/adapters/acp"
import { object } from "../main/adapters/types"

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
  test(`ACP ${legacy ? "legacy" : "config"} model discovery keeps per-model reasoning choices and default`, async () => {
    const models = await discover({
      ...(legacy ? { CODEINK_FIXTURE_ACP_LEGACY: "1" } : {}),
      CODEINK_FIXTURE_ACP_EFFORTS: JSON.stringify({
        "acp-one": ["default", "low", "high"],
        "acp-two": ["default", "medium", "xhigh"],
      }),
    })
    expect(models.map((model) => ({ id: model.id, variants: model.variants, reasoning: model.reasoning }))).toEqual([
      { id: "acp-one", variants: ["default", "low", "high"], reasoning: true },
      { id: "acp-two", variants: ["default", "medium", "xhigh"], reasoning: true },
    ])
    expect(models[0].default).toBe(true)
  })
}

test("ACP default-only models do not claim reasoning; metadata works without an initial thought selector", async () => {
  const models = await discover({
    CODEINK_FIXTURE_ACP_NO_REASONING: "1",
    CODEINK_FIXTURE_ACP_EFFORTS: JSON.stringify({ "acp-one": ["default"], "acp-two": ["default", "high"] }),
  })
  expect(models[0].variants).toEqual(["default"])
  expect(models[0].reasoning).toBe(false)
  expect(models[1].variants).toEqual(["default", "high"])
  expect(models[1].reasoning).toBe(true)
})

test("ACP older agents keep initial thought choices when per-model metadata is absent", async () => {
  const models = await discover()
  expect(models.map((model) => model.variants)).toEqual([["low", "high"], ["low", "high"]])
  expect(models.every((model) => model.reasoning)).toBe(true)
  const legacy = await discover({ CODEINK_FIXTURE_ACP_LEGACY: "1" })
  expect(legacy.map((model) => model.variants)).toEqual([[], []])
  expect(legacy.some((model) => model.reasoning)).toBe(false)
})

test("ACP filters malformed per-model efforts without copying another model's capabilities", async () => {
  const models = await discover({
    CODEINK_FIXTURE_ACP_EFFORTS: JSON.stringify({ "acp-one": ["default", "low", "low", null, ""], "acp-two": [] }),
  })
  expect(models[0].variants).toEqual(["default", "low"])
  expect(models[1].variants).toEqual([])
  expect(models[1].reasoning).toBe(false)
})
