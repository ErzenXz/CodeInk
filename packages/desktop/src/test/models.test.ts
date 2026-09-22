import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { discoverModels } from "../main/adapters/model-discovery"
import { object } from "../main/adapters/types"
import { ModelCatalog } from "../main/model-catalog"
import type { AgentStatus, Protocol } from "../shared/types"

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn()
})
const fixture = (protocol: Protocol): AgentStatus => ({
  id: protocol,
  name: protocol,
  protocol,
  command: process.execPath,
  executable: process.execPath,
  args: [join(import.meta.dirname, "fixtures/agent.ts"), protocol],
})
async function eventually(check: () => boolean) {
  const deadline = Date.now() + 5000
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Catalog did not settle")
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
}

for (const protocol of ["codex", "claude", "opencode", "pi"] as const) {
  test(`${protocol}: discovers real protocol catalogs without starting a conversation`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "codeink-models-"))
    const log = join(directory, "requests.jsonl")
    cleanup.push(() => rm(directory, { recursive: true, force: true }))
    const models = await discoverModels({
      agent: fixture(protocol),
      directory,
      env: { ...process.env, CODEINK_FIXTURE_RECORD: log },
      signal: AbortSignal.timeout(5000),
    })
    expect(models).toHaveLength(2)
    expect(models[0].default).toBe(true)
    expect(models[0].reasoning).toBe(true)
    const requests = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => object(JSON.parse(line)))
    expect(
      requests.some(
        (item) =>
          item.method === "thread/start" || item.type === "prompt" || item.type === "user" || item.path === "/session",
      ),
    ).toBe(false)
    if (protocol === "codex") {
      expect(models[0].id).toBe("fixture-model-one")
      expect(models[0].variants).toEqual(["medium", "high"])
      expect(requests.filter((item) => item.method === "model/list")).toHaveLength(2)
    }
    if (protocol === "claude") {
      expect(models[0].id).toBe("fixture-claude-one")
      expect(models[0].variants).toEqual(["low", "high"])
      expect(models[1].name).toBe("Claude Model Two")
    }
    if (protocol === "opencode") {
      expect(models[0].id).toBe("fixture-provider/model/one")
      expect(models[0].context).toBe(200000)
      expect(models[0].variants).toEqual(["high"])
      expect(models.some((model) => model.id.includes("disconnected") || model.id.endsWith("old"))).toBe(false)
      expect(JSON.stringify(models)).not.toContain("must-not-reach-renderer")
    }
    if (protocol === "pi") {
      expect(models[0].id).toBe("fixture-provider/pi-one")
      expect(models[0].context).toBe(128000)
      expect(models[0].cost?.cache).toEqual({ read: 0.1, write: 1.2 })
      expect(requests[0].argv).toContain("--no-session")
    }
  })
}

test("catalog coalesces requests, keeps agent groups, and refreshes invalidated configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-catalog-"))
  const log = join(directory, "requests.jsonl")
  let changes = 0
  const catalog = new ModelCatalog({ ...process.env, CODEINK_FIXTURE_RECORD: log }, () => changes++)
  cleanup.push(async () => {
    catalog.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  const agents = [fixture("codex"), fixture("claude"), { ...fixture("pi"), executable: undefined }]
  const initial = catalog.list(agents, directory)
  expect(initial.all[0].models.default.name).toContain("loading")
  expect(initial.connected).toEqual(["local-codex", "local-claude"])
  expect(initial.all[2].models).toEqual({})
  for (let i = 0; i < 5; i++) catalog.list(agents, directory)
  await eventually(() => changes === 2)
  const loaded = catalog.list(agents, directory)
  expect(loaded.default["local-codex"]).toBe("fixture-model-one")
  expect(Object.keys(loaded.all[0].models)).toHaveLength(2)
  expect(loaded.all[0].models["fixture-model-one"].release_date).toBe("")
  expect(loaded.all[0].models["fixture-model-one"].variants).toEqual({ medium: {}, high: {} })
  let records = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((line) => object(JSON.parse(line)))
  expect(records.filter((item) => item.argv)).toHaveLength(2)
  catalog.invalidate("codex")
  catalog.list(agents, directory)
  await eventually(() => changes === 3)
  records = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((line) => object(JSON.parse(line)))
  expect(records.filter((item) => item.argv)).toHaveLength(3)
})

test("a failed catalog exposes a named default fallback and never blocks another agent", async () => {
  let changes = 0
  const catalog = new ModelCatalog({ ...process.env, CODEINK_FIXTURE_CATALOG_MODE: "fail" }, () => changes++)
  cleanup.push(() => catalog.dispose())
  const agents = [fixture("codex"), fixture("claude")]
  catalog.list(agents, tmpdir())
  await eventually(() => changes === 2)
  const loaded = catalog.list(agents, tmpdir())
  expect(loaded.all[0].options.modelCatalogStatus).toBe("unavailable")
  expect(loaded.all[0].models.default.name).toContain("unavailable")
  expect(Object.keys(loaded.all[1].models)).toHaveLength(2)
})

test("aborting discovery promptly disposes a stalled agent", async () => {
  const controller = new AbortController()
  const discovery = discoverModels({
    agent: fixture("codex"),
    directory: tmpdir(),
    env: { ...process.env, CODEINK_FIXTURE_CATALOG_MODE: "hang" },
    signal: controller.signal,
  })
  const timer = setTimeout(() => controller.abort(), 100)
  try {
    await expect(discovery).rejects.toThrow()
  } finally {
    clearTimeout(timer)
  }
}, 2000)
