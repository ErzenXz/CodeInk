import { randomUUID } from "node:crypto"
import { t } from "../../shared/i18n"
import { AgentProcess } from "./process"
import { claudeUsage, count } from "./usage"
import { toolInfo } from "./tool-info"
import { array, detail, object, string, type Adapter, type AdapterOptions } from "./types"

export function claude(options: AdapterOptions): Adapter {
  let messageID: string = randomUUID()
  const streamed = new Set<string>()
  const requests = new Map<string, Record<string, unknown>>()
  let ready: Promise<unknown> | undefined
  let authenticationFailed = false
  const tools = new Map<string, ReturnType<typeof toolInfo>>()
  const proc = new AgentProcess({
    ...options,
    args: [
      ...options.agent.args,
      "--print",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-prompt-tool",
      "stdio",
      ...(options.remoteID ? ["--resume", options.remoteID] : []),
      ...(options.model ? ["--model", options.model] : []),
      ...(options.variant ? ["--effort", options.variant] : []),
    ],
    error: (text) => options.emit({ type: "error", text }),
    message: (message) => {
      if (message.session_id) options.emit({ type: "session", id: string(message.session_id) })
      if (message.type === "control_request") {
        const request = object(message.request)
        const id = string(message.request_id)
        if (request.subtype !== "can_use_tool") {
          proc.send({
            type: "control_response",
            response: { subtype: "error", request_id: id, error: t("unsupportedRequest") },
          })
          return
        }
        requests.set(id, request)
        const input = object(request.input)
        options.emit({
          type: "approval",
          approval: {
            id,
            title: string(request.tool_name),
            detail: detail(input),
            questions:
              request.tool_name === "AskUserQuestion"
                ? array(input.questions).map((value, index) => {
                    const question = object(value)
                    return {
                      id: String(index),
                      text: string(question.question),
                      multiple: question.multiSelect === true,
                      options: array(question.options).map((value) => string(object(value).label)),
                    }
                  })
                : undefined,
          },
        })
      }
      if (message.type === "control_cancel_request") {
        requests.delete(string(message.request_id))
        options.emit({ type: "approval-resolved", id: string(message.request_id) })
      }
      if (message.type === "stream_event") {
        const event = object(message.event)
        if (event.type === "message_start") messageID = string(object(event.message).id) || randomUUID()
        const delta = object(event.delta)
        if (event.type === "content_block_delta" && delta.type === "text_delta") {
          streamed.add(messageID)
          options.emit({ type: "text", id: messageID, text: string(delta.text) })
        }
      }
      if (message.type === "assistant") {
        if (message.error) {
          authenticationFailed ||= message.error === "authentication_failed"
          return
        }
        const assistant = object(message.message)
        const id = string(assistant.id) || messageID
        if (assistant.usage)
          options.emit({
            type: "usage",
            id,
            usage: { ...claudeUsage(assistant.usage), model: string(assistant.model) || undefined },
          })
        const content = array(assistant.content).map(object)
        // The completed message includes the same text as partial events.
        const text = content
          .filter((part) => part.type === "text")
          .map((part) => string(part.text))
          .join("\n")
        if (text) {
          streamed.add(id)
          options.emit({ type: "text", id, text, replace: true })
        }
        content
          .filter((part) => part.type === "tool_use")
          .forEach((part) => {
            const tool = toolInfo(string(part.name), part.input, { status: "running" })
            tools.set(string(part.id), tool)
            options.emit({
              type: "tool",
              id: string(part.id),
              text: `${string(part.name)}\n${detail(part.input)}`,
              tool,
            })
          })
      }
      if (message.type === "user")
        array(object(message.message).content)
          .map(object)
          .filter((part) => part.type === "tool_result")
          .forEach((part) => {
            const output = Array.isArray(part.content)
              ? array(part.content)
                  .map((value) => string(object(value).text))
                  .filter(Boolean)
                  .join("\n")
              : detail(part.content)
            options.emit({
              type: "tool",
              id: string(part.tool_use_id),
              text: output,
              tool: {
                ...(tools.get(string(part.tool_use_id)) ?? toolInfo("tool")),
                status: part.is_error ? "error" : "completed",
                output,
                ...(part.is_error ? { error: output } : {}),
              },
            })
          })
      if (message.type === "result") {
        const models = object(message.modelUsage)
        const selected = object(models[options.model] ?? Object.values(models).at(-1))
        // result.usage is cumulative across API calls; keep the last assistant's context footprint.
        options.emit({
          type: "usage",
          id: messageID,
          usage: { contextLimit: count(selected.contextWindow) },
          sessionCost: count(message.total_cost_usd),
        })
        requests.clear()
        if (message.is_error === true || message.subtype !== "success")
          options.emit({
            type: "error",
            text:
              authenticationFailed ||
              /OAuth session expired|not logged in|authentication.failed/i.test(string(message.result))
                ? t("claudeSignIn")
                : array(message.errors).map(string).join("\n") || string(message.result) || t("failed"),
          })
        else {
          if (!streamed.size && message.result)
            options.emit({ type: "text", id: messageID, text: string(message.result), replace: true })
          options.emit({ type: "done" })
        }
      }
    },
  })
  return {
    async prompt(text) {
      await (ready ??= proc.request((id) => ({
        type: "control_request",
        request_id: id,
        request: { subtype: "initialize", hooks: {} },
      })))
      messageID = randomUUID()
      streamed.clear()
      authenticationFailed = false
      tools.clear()
      proc.send({
        type: "user",
        message: { role: "user", content: text },
        parent_tool_use_id: null,
        session_id: options.remoteID ?? "",
      })
    },
    async stop() {
      await proc.request((id) => ({ type: "control_request", request_id: id, request: { subtype: "interrupt" } }))
    },
    async answer(id, answer) {
      const request = requests.get(id)
      if (!request) throw new Error(t("noApproval"))
      const input = object(request.input)
      const questions = array(input.questions).map(object)
      const updatedInput = answer.answers
        ? {
            ...input,
            answers: Object.fromEntries(
              questions.map((question, index) => [
                string(question.question),
                (answer.answers?.[String(index)] ?? []).join(", "),
              ]),
            ),
          }
        : input
      proc.send({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: id,
          response: answer.allow ? { behavior: "allow", updatedInput } : { behavior: "deny", message: t("denied") },
        },
      })
      requests.delete(id)
    },
    dispose: () => proc.dispose(),
  }
}
