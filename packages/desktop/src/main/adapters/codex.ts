import type { Answer } from "../../shared/types"
import { t } from "../../shared/i18n"
import { AgentProcess } from "./process"
import { codexUsage } from "./usage"
import { codexTool } from "./tool-info"
import { array, detail, object, string, type Adapter, type AdapterOptions } from "./types"

export function codex(options: AdapterOptions): Adapter {
  let thread = options.remoteID
  let turn = ""
  let ready: Promise<void> | undefined
  const requests = new Map<string, Record<string, unknown>>()
  const proc = new AgentProcess({
    ...options,
    args: [...options.agent.args, "app-server"],
    error: (text) => options.emit({ type: "error", text }),
    message: (message) => {
      const params = object(message.params)
      if (message.id !== undefined && message.method) {
        const method = string(message.method)
        const supported = [
          "item/commandExecution/requestApproval",
          "item/fileChange/requestApproval",
          "item/permissions/requestApproval",
          "item/tool/requestUserInput",
          "tool/requestUserInput",
        ]
        if (!supported.includes(method)) {
          proc.send({ id: message.id, error: { code: -32601, message: t("unsupportedRequest") } })
          return
        }
        const id = String(message.id)
        requests.set(id, message)
        options.emit({
          type: "approval",
          approval: {
            id,
            title: string(params.command) || string(params.reason) || method,
            detail: detail(params),
            questions: method.endsWith("requestUserInput")
              ? array(params.questions).map((value) => {
                  const question = object(value)
                  return {
                    id: string(question.id),
                    text: string(question.question),
                    options: array(question.options).map((value) => string(object(value).label)),
                  }
                })
              : undefined,
          },
        })
        return
      }
      if (params.threadId && params.threadId !== thread) return
      if (message.method === "thread/tokenUsage/updated")
        options.emit({ type: "usage", id: string(params.turnId) || turn, usage: codexUsage(params.tokenUsage) })
      if (message.method === "turn/started") turn = string(object(params.turn).id)
      if (message.method === "item/agentMessage/delta")
        options.emit({ type: "text", id: string(params.itemId), text: string(params.delta) })
      if (message.method === "item/started" || message.method === "item/completed") {
        const item = object(params.item)
        if (item.type === "agentMessage" && message.method === "item/completed")
          options.emit({ type: "text", id: string(item.id), text: string(item.text), replace: true })
        if (["commandExecution", "fileChange", "mcpToolCall", "webSearch"].includes(string(item.type)))
          options.emit({
            type: "tool",
            id: string(item.id),
            text: detail(item),
            tool: codexTool(item, message.method === "item/completed"),
          })
      }
      if (message.method === "serverRequest/resolved") {
        requests.delete(String(params.requestId))
        options.emit({ type: "approval-resolved", id: String(params.requestId) })
      }
      if (message.method === "error" && params.willRetry !== true)
        options.emit({ type: "error", text: string(object(params.error).message) || t("failed") })
      if (message.method === "turn/completed") {
        turn = ""
        requests.clear()
        const completed = object(params.turn)
        if (completed.status === "failed")
          options.emit({ type: "error", text: string(object(completed.error).message) || t("failed") })
        else options.emit({ type: "done" })
      }
    },
  })
  const rpc = async (method: string, params: unknown) =>
    object((await proc.request((id) => ({ id, method, params }))).result)
  const initialize = async () => {
    await rpc("initialize", { clientInfo: { name: "codeink", title: "CodeInk", version: "0.1.0" } })
    proc.send({ method: "initialized", params: {} })
    const response = await rpc(thread ? "thread/resume" : "thread/start", {
      ...(thread ? { threadId: thread } : {}),
      cwd: options.directory,
      ...(options.model ? { model: options.model } : {}),
      // Keep approvals explicit; never request a sandbox bypass.
      approvalPolicy: "on-request",
    })
    if (response.model) options.emit({ type: "usage", id: "model", usage: { model: string(response.model) } })
    thread = string(object(response.thread).id)
    if (!thread) throw new Error(t("malformedProtocol"))
    options.emit({ type: "session", id: thread })
  }
  return {
    async prompt(text) {
      await (ready ??= initialize())
      const response = await rpc("turn/start", {
        threadId: thread,
        input: [{ type: "text", text }],
        ...(options.model ? { model: options.model } : {}),
        ...(options.variant ? { effort: options.variant } : {}),
      })
      turn = string(object(response.turn).id)
    },
    async stop() {
      if (thread && turn) await rpc("turn/interrupt", { threadId: thread, turnId: turn })
      else proc.dispose()
    },
    async answer(id: string, answer: Answer) {
      const request = requests.get(id)
      if (!request) throw new Error(t("noApproval"))
      const method = string(request.method)
      const result = method.endsWith("requestUserInput")
        ? {
            answers: Object.fromEntries(
              Object.entries(answer.answers ?? {}).map(([key, answers]) => [key, { answers }]),
            ),
          }
        : method === "item/permissions/requestApproval"
          ? { permissions: answer.allow ? object(request.params).permissions : {}, scope: "turn" }
          : { decision: answer.allow ? "accept" : "decline" }
      proc.send({ id: request.id, result })
      requests.delete(id)
    },
    dispose: () => proc.dispose(),
  }
}
