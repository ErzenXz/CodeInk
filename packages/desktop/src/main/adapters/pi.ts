import { randomUUID } from "node:crypto"
import { t } from "../../shared/i18n"
import { readFile } from "node:fs/promises"
import { AgentProcess } from "./process"
import { piUsage, count } from "./usage"
import { toolInfo } from "./tool-info"
import { array, detail, object, string, type Adapter, type AdapterOptions } from "./types"

export function pi(options: AdapterOptions): Adapter {
  let messageID = randomUUID()
  let contextLimit: number | undefined
  let ready: Promise<unknown> | undefined
  const requests = new Map<string, string>()
  const tools = new Map<string, ReturnType<typeof toolInfo>>()
  const proc = new AgentProcess({
    ...options,
    args: [
      ...options.agent.args,
      "--mode",
      "rpc",
      ...(options.remoteID ? ["--session", options.remoteID] : []),
      ...(options.model ? ["--model", options.model] : []),
    ],
    error: (text) => options.emit({ type: "error", text }),
    message: (message) => {
      if (message.type === "message_start" && object(message.message).role === "assistant") messageID = randomUUID()
      const event = object(message.assistantMessageEvent)
      if (message.type === "message_update" && event.type === "text_delta")
        options.emit({ type: "text", id: messageID, text: string(event.delta) })
      if (message.type === "message_end") {
        const result = object(message.message)
        if (result.role === "assistant") {
          if (result.usage)
            options.emit({
              type: "usage",
              id: messageID,
              usage: {
                ...piUsage(result.usage),
                contextLimit,
                model:
                  result.provider && result.model ? `${string(result.provider)}/${string(result.model)}` : undefined,
              },
              cost: count(object(object(result.usage).cost).total),
            })
          const text = array(result.content)
            .map(object)
            .filter((part) => part.type === "text")
            .map((part) => string(part.text))
            .join("\n")
          if (text) options.emit({ type: "text", id: messageID, text, replace: true })
          if (result.stopReason === "error")
            options.emit({ type: "error", text: string(result.errorMessage) || t("failed") })
        }
      }
      if (string(message.type).startsWith("tool_execution_")) {
        const id = string(message.toolCallId)
        const previous = tools.get(id)
        const tool = {
          ...(previous ?? toolInfo(string(message.toolName) || "tool", message.args)),
          status: (message.isError ? "error" : message.type === "tool_execution_end" ? "completed" : "running") as
            | "error"
            | "completed"
            | "running",
          output:
            message.result || message.partialResult
              ? array(object(message.result ?? message.partialResult).content)
                  .map((part) => string(object(part).text))
                  .filter(Boolean)
                  .join("\n") || detail(message.result ?? message.partialResult)
              : previous?.output,
        }
        tools.set(id, tool)
        options.emit({
          type: "tool",
          id,
          text: `${string(message.toolName)}\n${detail(message.result ?? message.partialResult ?? message.args)}`,
          tool,
        })
      }
      if (message.type === "agent_settled") options.emit({ type: "done" })
      // Older Pi versions only emit agent_end. Confirm session-level idleness.
      if (message.type === "agent_end" && message.willRetry !== true) {
        void state()
          .then((value) => {
            if (!value.isStreaming && !value.isCompacting && !value.pendingMessageCount) options.emit({ type: "done" })
          })
          .catch((error: Error) => options.emit({ type: "error", text: error.message }))
      }
      if (message.type === "extension_ui_request") {
        const id = string(message.id)
        const method = string(message.method)
        if (!["select", "confirm", "input", "editor"].includes(method)) return
        requests.set(id, method)
        options.emit({
          type: "approval",
          approval: {
            id,
            title: string(message.title) || t("permission"),
            detail: string(message.message),
            questions:
              method === "confirm"
                ? undefined
                : [{ id: "value", text: string(message.title), options: array(message.options).map(string) }],
          },
        })
      }
    },
  })
  const state = async () => {
    const value = object((await proc.request((id) => ({ id, type: "get_state" }))).data)
    contextLimit = count(object(value.model).contextWindow)
    if (value.sessionFile) options.emit({ type: "session", id: string(value.sessionFile) })
    return value
  }
  return {
    async prompt(text, attachments = []) {
      await (ready ??= state())
      const images = await Promise.all(attachments.filter((item) => item.mime.startsWith("image/")).map(async (item) => ({
        type: "image", data: (await readFile(item.path)).toString("base64"), mimeType: item.mime,
      })))
      await proc.request((id) => ({
        id, type: "prompt",
        message: [text, ...attachments.filter((item) => !item.mime.startsWith("image/")).map((item) => `@${item.path}`)].filter(Boolean).join("\n"),
        images,
      }))
      await state()
    },
    async stop() {
      await proc.request((id) => ({ id, type: "abort" }))
    },
    async answer(id, answer) {
      const method = requests.get(id)
      if (!method) throw new Error(t("noApproval"))
      proc.send({
        type: "extension_ui_response",
        id,
        ...(method === "confirm"
          ? { confirmed: answer.allow }
          : answer.allow
            ? { value: answer.answers?.value?.[0] ?? "" }
            : { cancelled: true }),
      })
      requests.delete(id)
    },
    dispose: () => proc.dispose(),
  }
}
