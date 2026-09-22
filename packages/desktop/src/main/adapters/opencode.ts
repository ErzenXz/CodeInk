import { t } from "../../shared/i18n"
import { openCodeServer } from "./opencode-server"
import { openCodeUsage, count } from "./usage"
import { toolInfo } from "./tool-info"
import { array, detail, object, string, type Adapter, type AdapterOptions } from "./types"

export function opencode(options: AdapterOptions): Adapter {
  const requests = new Map<string, Record<string, unknown>>()
  const roles = new Map<string, string>()
  let session = options.remoteID
  let disposed = false
  let ready: Promise<void> | undefined
  const server = openCodeServer({ ...options, error: (text) => options.emit({ type: "error", text }) })
  const request = server.request
  const receive = (message: Record<string, unknown>) => {
    const properties = object(message.properties)
    if (message.type === "message.updated") {
      const info = object(properties.info)
      if (info.sessionID !== session) return
      roles.set(string(info.id), string(info.role))
      if (info.role === "assistant" && info.tokens)
        options.emit({
          type: "usage",
          id: string(info.id),
          usage: {
            ...openCodeUsage(info.tokens),
            model: info.providerID && info.modelID ? `${string(info.providerID)}/${string(info.modelID)}` : undefined,
          },
          cost: count(info.cost),
        })
      return
    }
    if (message.type === "message.part.updated") {
      const part = object(properties.part)
      if (part.sessionID !== session || roles.get(string(part.messageID)) === "user") return
      if (part.type === "text")
        options.emit({ type: "text", id: string(part.id), text: string(part.text), replace: true })
      if (part.type === "tool")
        options.emit({
          type: "tool",
          id: string(part.id),
          text: `${string(part.tool)}\n${detail(part.state)}`,
          tool: toolInfo(string(part.tool), object(part.state).input, {
            status:
              object(part.state).status === "error"
                ? "error"
                : object(part.state).status === "completed"
                  ? "completed"
                  : "running",
            output: string(object(part.state).output),
            title: string(object(part.state).title),
            error: string(object(part.state).error),
            metadata: object(object(part.state).metadata),
          }),
        })
      return
    }
    if (properties.sessionID !== session) return
    if (
      message.type === "message.part.delta" &&
      properties.field === "text" &&
      roles.get(string(properties.messageID)) !== "user"
    )
      options.emit({ type: "text", id: string(properties.partID), text: string(properties.delta) })
    if (
      message.type === "session.idle" ||
      (message.type === "session.status" && object(properties.status).type === "idle")
    )
      options.emit({ type: "done" })
    if (message.type === "session.error")
      options.emit({
        type: "error",
        text: string(object(object(properties.error).data).message) || detail(properties.error),
      })
    if (message.type === "permission.asked" || message.type === "question.asked") {
      const id = string(properties.id)
      requests.set(id, message)
      options.emit({
        type: "approval",
        approval: {
          id,
          title: string(properties.permission) || t("permission"),
          detail: detail(properties),
          questions:
            message.type === "question.asked"
              ? array(properties.questions).map((value, index) => {
                  const question = object(value)
                  return {
                    id: String(index),
                    text: string(question.question),
                    multiple: question.multiple === true,
                    options: array(question.options).map((value) => string(object(value).label)),
                  }
                })
              : undefined,
        },
      })
    }
    if (
      message.type === "permission.replied" ||
      message.type === "question.replied" ||
      message.type === "question.rejected"
    ) {
      const id = string(properties.requestID)
      requests.delete(id)
      options.emit({ type: "approval-resolved", id })
    }
  }
  const initialize = async () => {
    if (!session) session = string(object(await (await request("/session", {})).json()).id)
    if (!session) throw new Error(t("malformedProtocol"))
    options.emit({ type: "session", id: session })
    const stream = await request("/event", undefined, true)
    if (!stream.ok || !stream.body) throw new Error(t("connectionClosed"))
    const reader = stream.body.getReader()
    void (async () => {
      const decoder = new TextDecoder()
      let pending = ""
      for (;;) {
        const value = await reader.read()
        if (value.done) {
          if (!disposed) throw new Error(t("connectionClosed"))
          return
        }
        pending += decoder.decode(value.value, { stream: true }).replace(/\r\n/g, "\n")
        if (pending.length > 16 * 1024 * 1024) throw new Error(t("malformedProtocol"))
        for (;;) {
          const end = pending.indexOf("\n\n")
          if (end < 0) break
          const frame = pending.slice(0, end)
          pending = pending.slice(end + 2)
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n")
          if (data) receive(object(JSON.parse(data)))
        }
      }
    })().catch((error: Error) => {
      if (!disposed) options.emit({ type: "error", text: error.message })
    })
  }
  return {
    async prompt(text) {
      await (ready ??= initialize())
      const [providerID, ...model] = options.model.split("/")
      await request(`/session/${encodeURIComponent(session!)}/prompt_async`, {
        parts: [{ type: "text", text }],
        ...(providerID && model.length ? { model: { providerID, modelID: model.join("/") } } : {}),
        ...(options.variant ? { variant: options.variant } : {}),
      })
    },
    async stop() {
      if (session) await request(`/session/${encodeURIComponent(session)}/abort`, {})
    },
    async answer(id, answer) {
      const pending = requests.get(id)
      if (!pending) throw new Error(t("noApproval"))
      if (pending.type === "question.asked") {
        if (answer.allow)
          await request(`/question/${encodeURIComponent(id)}/reply`, {
            answers: array(object(pending.properties).questions).map(
              (_, index) => answer.answers?.[String(index)] ?? [],
            ),
          })
        else await request(`/question/${encodeURIComponent(id)}/reject`, {})
      } else await request(`/permission/${encodeURIComponent(id)}/reply`, { reply: answer.allow ? "once" : "reject" })
      requests.delete(id)
    },
    dispose() {
      disposed = true
      server.dispose()
    },
  }
}
