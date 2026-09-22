import type { Provider } from "@opencode-ai/sdk/v2/client"
import type { AgentStatus } from "../shared/types"
import { t } from "../shared/i18n"
import { discoverModels, type AgentModel } from "./adapters/model-discovery"

type Entry = {
  agentID: string
  models: AgentModel[]
  status: "loading" | "ready" | "unavailable"
  expires: number
  pending?: Promise<void>
  controller?: AbortController
}

export class ModelCatalog {
  private entries = new Map<string, Entry>()
  private closed = false
  constructor(
    private env: NodeJS.ProcessEnv,
    private changed: () => void,
  ) {}

  list(agents: AgentStatus[], directory: string) {
    const all: Provider[] = []
    const defaults: Record<string, string> = {}
    for (const agent of agents) {
      const entry = agent.executable ? this.entry(agent, directory) : undefined
      const providerID = `local-${agent.id}`
      const models = entry?.models.length
        ? entry.models
        : agent.executable
          ? [
              {
                id: "default",
                name: t(entry?.status === "loading" ? "modelsLoadingDefault" : "modelsUnavailableDefault"),
                default: true,
              },
            ]
          : []
      all.push({
        id: providerID,
        name: agent.name,
        source: "env",
        env: [],
        options: { modelCatalogStatus: entry?.status ?? "missing" },
        models: Object.fromEntries(models.map((model, order) => [model.id, toModel(providerID, model, order)])),
      })
      defaults[providerID] = models.find((model) => model.default)?.id || models[0]?.id || "default"
    }
    return {
      all,
      default: defaults,
      connected: agents.filter((agent) => agent.executable).map((agent) => `local-${agent.id}`),
    }
  }

  invalidate(agentID?: string) {
    for (const [key, entry] of this.entries) {
      if (agentID && entry.agentID !== agentID) continue
      this.entries.delete(key)
      entry.controller?.abort()
    }
  }

  dispose() {
    this.closed = true
    this.invalidate()
  }

  private entry(agent: AgentStatus, directory: string) {
    const key = JSON.stringify([agent.id, agent.protocol, agent.executable, agent.args, directory])
    const cached = this.entries.get(key)
    if (cached?.pending || (cached && cached.expires > Date.now()) || this.closed) return cached
    // Limit retained project catalogs; cancelling eviction also releases its process.
    if (!cached && this.entries.size >= 256) {
      const oldest = this.entries.entries().next().value
      if (oldest) {
        this.entries.delete(oldest[0])
        oldest[1].controller?.abort()
      }
    }
    const entry: Entry = cached ?? { agentID: agent.id, models: [], status: "loading", expires: 0 }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    entry.controller = controller
    this.entries.set(key, entry)
    entry.pending = discoverModels({ agent, directory, env: this.env, signal: controller.signal })
      .then((models) => {
        entry.models = models.sort((a, b) => Number(b.default === true) - Number(a.default === true))
        entry.status = models.length ? "ready" : "unavailable"
        entry.expires = Date.now() + (models.length ? 5 * 60_000 : 30_000)
      })
      .catch(() => {
        entry.status = "unavailable"
        entry.expires = Date.now() + 30_000
      })
      .finally(() => {
        clearTimeout(timer)
        entry.pending = undefined
        entry.controller = undefined
        if (!this.closed && this.entries.get(key) === entry) this.changed()
      })
    return entry
  }
}

function toModel(providerID: string, model: AgentModel, order: number): Provider["models"][string] {
  return {
    id: model.id,
    providerID,
    name: model.name,
    family: model.id,
    api: { id: model.id, url: "", npm: "" },
    capabilities: {
      temperature: false,
      reasoning: model.reasoning === true,
      attachment: false,
      toolcall: true,
      input: { text: true, image: false, audio: false, video: false, pdf: false },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: model.cost ?? { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: model.context ?? 0, output: model.output ?? 0 },
    status: "active",
    options: { codeinkOrder: order, ...(model.tag ? { codeinkTag: model.tag } : {}) },
    headers: {},
    // The agent already filters availability. Do not hide its models by release age.
    release_date: "",
    variants: Object.fromEntries((model.variants ?? []).map((variant) => [variant, {}])),
  }
}
