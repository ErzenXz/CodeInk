import { count } from "./usage"
import { randomUUID } from "node:crypto"
import { t } from "../../shared/i18n"
import { AgentProcess } from "./process"
import { array, detail, object, string, type Adapter, type AdapterOptions } from "./types"
import { toolInfo } from "./tool-info"
import type { AgentModel, ModelDiscoveryOptions } from "./model-discovery"

function choices(option: Record<string, unknown>): Record<string, unknown>[] {
  return array(option.options)
    .map(object)
    .flatMap((item) => (Array.isArray(item.options) ? choices(item) : [item]))
}

function connection(
  options: Pick<AdapterOptions, "agent" | "executable" | "directory" | "env"> & {
    message: (message: Record<string, unknown>) => void
    error: (text: string) => void
  },
) {
  const proc = new AgentProcess({ ...options, args: options.agent.args })
  const rpc = async (method: string, params: unknown, timeout?: number) =>
    object((await proc.request((id) => ({ jsonrpc: "2.0", id, method, params }), timeout)).result)
  return {
    proc,
    rpc,
    async initialize() {
      const result = await rpc(
        "initialize",
        {
          protocolVersion: 1,
          // Agents keep ownership of filesystem and command tools. Never advertise
          // client capabilities that this bridge does not implement.
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: "codeink", title: "CodeInk", version: "0.1.0" },
        },
        15000,
      )
      if (result.protocolVersion !== 1) throw new Error(t("acpVersionUnsupported"))
      return object(result.agentCapabilities)
    },
    reject(message: Record<string, unknown>) {
      if (message.id === undefined) return
      proc.send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: t("unsupportedRequest") } })
    },
  }
}

export async function acpModels(options: ModelDiscoveryOptions): Promise<AgentModel[]> {
  const peer = connection({
    ...options,
    executable: options.agent.executable!,
    message: (message) => {
      if (message.method === "session/request_permission")
        peer.proc.send({ jsonrpc: "2.0", id: message.id, result: { outcome: { outcome: "cancelled" } } })
      else peer.reject(message)
    },
    error: () => {},
  })
  const dispose = () => peer.proc.dispose()
  options.signal.addEventListener("abort", dispose, { once: true })
  if (options.signal.aborted) dispose()
  try {
    const capabilities = await peer.initialize()
    const session = await peer.rpc("session/new", { cwd: options.directory, mcpServers: [] })
    const config = array(session.configOptions).map(object)
    const model = config.find((option) => option.category === "model" && option.type === "select")
    const reasoning = config.find((option) => option.category === "thought_level" && option.type === "select")
    const native = object(session.models)
    const models = model
      ? choices(model).map((item) => ({
          id: string(item.value),
          name: string(item.name) || string(item.value),
          default: item.value === model.currentValue,
        }))
      : array(native.availableModels)
          .map(object)
          .map((item) => ({
            id: string(item.modelId),
            name: string(item.name) || string(item.modelId),
            default: item.modelId === native.currentModelId,
          }))
    // Catalog probing never prompts. Remove its empty session when the agent
    // supports deletion; older ACP agents may retain an empty native session.
    if (object(capabilities.sessionCapabilities).delete && session.sessionId)
      await peer.rpc("session/delete", { sessionId: session.sessionId }).catch(() => {})
    return models.length
      ? models
          .filter((item) => item.id)
          .map((item) => ({
            ...item,
            reasoning: Boolean(reasoning),
            variants: reasoning
              ? choices(reasoning)
                  .map((choice) => string(choice.value))
                  .filter(Boolean)
              : [],
          }))
      : [{ id: "default", name: t("agentDefaultModel"), default: true }]
  } finally {
    options.signal.removeEventListener("abort", dispose)
    dispose()
  }
}

export function acp(options: AdapterOptions): Adapter {
  let session = options.remoteID
  let ready: Promise<void> | undefined
  let loading = true
  let selection = { model: options.model, variant: options.variant }
  let config: Record<string, unknown>[] = []
  let models: Record<string, unknown> = {}
  let messageID = randomUUID()
  let textSegment = 0
  let disposed = false
  const requests = new Map<string, Record<string, unknown>>()
  const tools = new Map<string, ReturnType<typeof toolInfo>>()
  const peer = connection({
    ...options,
    error: (text) => options.emit({ type: "error", text }),
    message: (message) => {
      const params = object(message.params)
      if (params.sessionId && session && params.sessionId !== session) return peer.reject(message)
      if (message.method === "session/request_permission") {
        if (loading) {
          peer.proc.send({ jsonrpc: "2.0", id: message.id, result: { outcome: { outcome: "cancelled" } } })
          return
        }
        const id = String(message.id)
        requests.set(id, message)
        const tool = object(params.toolCall)
        options.emit({
          type: "approval",
          approval: { id, title: string(tool.title) || t("permission"), detail: detail(tool.rawInput ?? tool) },
        })
        return
      }
      if (message.method !== "session/update") return peer.reject(message)
      const update = object(params.update)
      if (update.sessionUpdate === "config_option_update") config = array(update.configOptions).map(object)
      if (loading) return
      if (update.sessionUpdate === "usage_update")
        options.emit({
          type: "usage",
          id: messageID,
          usage: { contextUsed: count(update.used), contextLimit: count(update.size) },
          sessionCost: object(update.cost).currency === "USD" ? count(object(update.cost).amount) : undefined,
        })
      if (update.sessionUpdate === "agent_message_chunk" && object(update.content).type === "text")
        options.emit({
          type: "text",
          id: `${string(update.messageId) || messageID}:${textSegment}`,
          text: string(object(update.content).text),
        })
      if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
        const id = string(update.toolCallId)
        const previous = tools.get(id)
        if (!previous) textSegment++
        const name =
          (
            { execute: "bash", read: "read", edit: "edit", search: "grep", fetch: "webfetch" } as Record<string, string>
          )[string(update.kind)] ||
          string(update.title) ||
          previous?.name ||
          "tool"
        const output =
          update.rawOutput === undefined
            ? array(update.content)
                .map(object)
                .map((part) => string(object(part.content).text))
                .filter(Boolean)
                .join("\n") || previous?.output
            : detail(update.rawOutput)
        const tool = {
          ...toolInfo(previous?.name ?? name, update.rawInput ?? previous?.input),
          metadata: { ...previous?.metadata, locations: update.locations ?? previous?.metadata?.locations },
          title: string(update.title) || previous?.title || name,
          status: (update.status === "failed" ? "error" : update.status === "completed" ? "completed" : "running") as
            | "error"
            | "completed"
            | "running",
          output,
        }
        const location = object(array(update.locations)[0])
        if (location.path && !tool.input?.filePath && ["read", "edit", "write"].includes(tool.name))
          tool.input = { ...tool.input, filePath: location.path }
        if (typeof update.rawInput === "string" && tool.name === "bash") tool.input = { command: update.rawInput }
        tools.set(id, tool)
        options.emit({ type: "tool", id, text: output || tool.title, tool })
      }
    },
  })
  const initialize = async () => {
    const capabilities = await peer.initialize()
    const method = session
      ? object(capabilities.sessionCapabilities).resume
        ? "session/resume"
        : capabilities.loadSession
          ? "session/load"
          : undefined
      : "session/new"
    if (!method) throw new Error(t("acpResumeUnsupported"))
    const result = await peer.rpc(method, {
      cwd: options.directory,
      mcpServers: [],
      ...(session ? { sessionId: session } : {}),
    })
    session = session || string(result.sessionId)
    if (!session) throw new Error(t("malformedProtocol"))
    config = array(result.configOptions).map(object)
    models = object(result.models)
    loading = false
    options.emit({ type: "session", id: session })
  }
  const setOption = async (option: Record<string, unknown>, value: string) => {
    if (!choices(option).some((item) => item.value === value)) throw new Error(t("acpModelUnavailable"))
    if (option.currentValue === value) return
    const result = await peer.rpc("session/set_config_option", { sessionId: session, configId: option.id, value })
    if (Array.isArray(result.configOptions)) config = result.configOptions.map(object)
    else option.currentValue = value
  }
  const cancelPermissions = () => {
    for (const [id, request] of requests) {
      try {
        peer.proc.send({ jsonrpc: "2.0", id: request.id, result: { outcome: { outcome: "cancelled" } } })
      } catch {
        /* Agent may already have exited. */
      }
      options.emit({ type: "approval-resolved", id })
    }
    requests.clear()
  }
  return {
    configure(model, variant) {
      selection = { model, variant }
    },
    async prompt(text) {
      await (ready ??= initialize())
      const model = config.find((option) => option.category === "model" && option.type === "select")
      if (selection.model) {
        if (model) await setOption(model, selection.model)
        else if (array(models.availableModels).some((value) => object(value).modelId === selection.model)) {
          await peer.rpc("session/set_model", { sessionId: session, modelId: selection.model })
          models.currentModelId = selection.model
        } else throw new Error(t("acpModelUnavailable"))
      }
      const thought = config.find((option) => option.category === "thought_level" && option.type === "select")
      if (selection.variant && thought) await setOption(thought, selection.variant)
      messageID = randomUUID()
      tools.clear()
      void peer
        .rpc("session/prompt", { sessionId: session, prompt: [{ type: "text", text }] }, 0)
        .then(() => {
          if (!disposed) options.emit({ type: "done" })
        })
        .catch((error: Error) => {
          if (!disposed)
            options.emit({
              type: "error",
              text: /auth/i.test(error.message) ? `${error.message}\n${t("externalSignIn")}` : error.message,
            })
        })
    },
    async stop() {
      cancelPermissions()
      if (session) peer.proc.send({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId: session } })
    },
    async answer(id, answer) {
      const request = requests.get(id)
      if (!request) throw new Error(t("noApproval"))
      const choices = array(object(request.params).options).map(object)
      // A one-time UI approval must not silently grant persistent permission.
      const selected = choices.find((option) => option.kind === (answer.allow ? "allow_once" : "reject_once"))
      peer.proc.send({
        jsonrpc: "2.0",
        id: request.id,
        result: { outcome: selected ? { outcome: "selected", optionId: selected.optionId } : { outcome: "cancelled" } },
      })
      requests.delete(id)
    },
    dispose() {
      if (disposed) return
      disposed = true
      cancelPermissions()
      peer.proc.dispose()
    },
  }
}
