import type { AgentStatus } from "../../shared/types"
import { t } from "../../shared/i18n"
import { AgentProcess } from "./process"
import { array, object, string } from "./types"
import { openCodeServer } from "./opencode-server"
import { acpModels } from "./acp"

export type AgentModel = {
  id: string
  name: string
  tag?: string
  default?: boolean
  reasoning?: boolean
  variants?: string[]
  context?: number
  output?: number
  cost?: { input: number; output: number; cache: { read: number; write: number } }
}
export type ModelDiscoveryOptions = {
  agent: AgentStatus
  directory: string
  env: NodeJS.ProcessEnv
  signal: AbortSignal
}

export async function discoverModels(options: ModelDiscoveryOptions): Promise<AgentModel[]> {
  if (!options.agent.executable) return []
  if (options.signal.aborted) throw new Error(t("processStopped"))
  if (options.agent.protocol === "opencode") return openCodeModels(options)
  if (options.agent.protocol === "acp") return acpModels(options)
  const proc = new AgentProcess({
    executable: options.agent.executable,
    directory: options.directory,
    env: options.env,
    args: [
      ...options.agent.args,
      ...(options.agent.protocol === "codex"
        ? ["app-server"]
        : options.agent.protocol === "pi"
          ? ["--mode", "rpc", "--no-session"]
          : [
              "--print",
              "--input-format",
              "stream-json",
              "--output-format",
              "stream-json",
              "--verbose",
              "--permission-prompt-tool",
              "stdio",
            ]),
    ],
    message: () => {},
    error: () => {},
  })
  const dispose = () => proc.dispose()
  options.signal.addEventListener("abort", dispose, { once: true })
  if (options.signal.aborted) dispose()
  try {
    if (options.agent.protocol === "codex") {
      await proc.request(
        (id) => ({ id, method: "initialize", params: { clientInfo: { name: "codeink", version: "0.1.0" } } }),
        10_000,
      )
      proc.send({ method: "initialized", params: {} })
      const models: AgentModel[] = []
      const cursors = new Set<string>()
      let cursor: string | undefined
      do {
        const page = object(
          (
            await proc.request(
              (id) => ({
                id,
                method: "model/list",
                params: { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) },
              }),
              10_000,
            )
          ).result,
        )
        array(page.data)
          .map(object)
          .filter((item) => item.hidden !== true)
          .forEach((item) => {
            const id = string(item.model) || string(item.id)
            if (!id) return
            const variants = array(item.supportedReasoningEfforts)
              .map((value) => string(object(value).reasoningEffort))
              .filter(Boolean)
            models.push({
              id,
              name: string(item.displayName) || id,
              default: item.isDefault === true,
              reasoning: variants.length > 0,
              variants,
            })
          })
        cursor = string(page.nextCursor) || undefined
        if (cursor && cursors.has(cursor)) throw new Error(t("malformedProtocol"))
        if (cursor) cursors.add(cursor)
      } while (cursor)
      return unique(models)
    }
    if (options.agent.protocol === "claude") {
      const response = await proc.request(
        (id) => ({ type: "control_request", request_id: id, request: { subtype: "initialize", hooks: {} } }),
        10_000,
      )
      return unique(
        array(object(object(response.response).response).models)
          .map(object)
          .flatMap((item) => {
            const value = string(item.value)
            const resolved = string(item.resolvedModel)
            const id = resolved
              ? resolved + (value.endsWith("[1m]") && !resolved.endsWith("[1m]") ? "[1m]" : "")
              : value
            if (!id) return []
            return [
              {
                id,
                name: resolved ? claudeModelName(id) : string(item.displayName) || id,
                default: value === "default",
                reasoning: item.supportsEffort === true,
                variants: array(item.supportedEffortLevels).map(string).filter(Boolean),
              },
            ]
          }),
      )
    }
    const response = await proc.request((id) => ({ id, type: "get_available_models" }), 10_000)
    const state = object((await proc.request((id) => ({ id, type: "get_state" }), 10_000)).data)
    const selected = object(state.model)
    return unique(
      array(object(response.data).models)
        .map(object)
        .flatMap((item) => {
          const id = string(item.id)
          const provider = string(item.provider)
          if (!id || !provider) return []
          return [
            {
              id: `${provider}/${id}`,
              name: `${string(item.name) || id} · ${provider}`,
              default: selected.id === id && selected.provider === provider,
              reasoning: item.reasoning === true,
              context: number(item.contextWindow),
              output: number(item.maxTokens),
              cost: costs(item.cost),
            },
          ]
        }),
    )
  } finally {
    options.signal.removeEventListener("abort", dispose)
    dispose()
  }
}

async function openCodeModels(options: ModelDiscoveryOptions): Promise<AgentModel[]> {
  const server = openCodeServer({ ...options, executable: options.agent.executable!, error: () => {} })
  try {
    const catalog = object(await (await server.request("/provider")).json())
    const config = object(
      await server
        .request("/config")
        .then((response) => response.json())
        .catch(() => ({})),
    )
    const connected = new Set(array(catalog.connected).map(string))
    return unique(
      array(catalog.all)
        .map(object)
        .filter((provider) => connected.has(string(provider.id)))
        .flatMap((provider) =>
          Object.entries(object(provider.models)).flatMap(([key, value]) => {
            const item = object(value)
            if (item.status === "deprecated" || item.status === "disabled") return []
            const nativeID = string(item.id) || key
            const id = `${string(provider.id)}/${nativeID}`
            const limit = object(item.limit)
            return [
              {
                id,
                name: (string(item.name) || nativeID).replace(/\s+Free$/i, ""),
                tag:
                  provider.id === "opencode-go"
                    ? "GO"
                    : provider.id === "opencode"
                      ? object(item.cost).input === 0 && object(item.cost).output === 0
                        ? "FREE"
                        : "ZEN"
                      : string(provider.name) || string(provider.id),
                default: config.model === id,
                reasoning: object(item.capabilities).reasoning === true,
                variants: Object.keys(object(item.variants)).filter(
                  (name) => object(object(item.variants)[name]).disabled !== true,
                ),
                context: number(limit.context),
                output: number(limit.output),
                cost: costs(item.cost),
              },
            ]
          }),
        ),
    )
  } finally {
    server.dispose()
  }
}

function unique(models: AgentModel[]) {
  const found = new Map<string, AgentModel>()
  for (const model of models) if (!found.has(model.id)) found.set(model.id, model)
  return [...found.values()]
}
function claudeModelName(id: string) {
  const match = /^claude-([a-z]+)-(\d+(?:-\d+)*?)(?:-\d{8})?(\[1m\])?$/i.exec(id)
  if (!match) return id
  return `Claude ${match[1][0].toUpperCase()}${match[1].slice(1)} ${match[2].replaceAll("-", ".")}${match[3] ? " (1M)" : ""}`
}
function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0
}
function costs(value: unknown): AgentModel["cost"] {
  const cost = object(value)
  return {
    input: number(cost.input),
    output: number(cost.output),
    cache: {
      read: number(object(cost.cache).read ?? cost.cacheRead),
      write: number(object(cost.cache).write ?? cost.cacheWrite),
    },
  }
}
