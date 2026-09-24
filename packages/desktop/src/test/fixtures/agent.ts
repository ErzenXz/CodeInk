// Protocol peer used by integration tests. It is a real subprocess, never shipped.
import { createServer, type ServerResponse } from "node:http"
import { appendFileSync } from "node:fs"
import { JsonLines } from "../../main/adapters/process"
import { array, object, string } from "../../main/adapters/types"

const protocol = process.argv[2]
const record = (value: unknown) => {
  if (process.env.CODEINK_FIXTURE_RECORD)
    appendFileSync(process.env.CODEINK_FIXTURE_RECORD, JSON.stringify(value) + "\n")
}
record({ argv: process.argv.slice(3), protocol })
const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + "\n")
const text = "Hello 🌍\u2028from your agent"
let initialized = false
let streaming = false
let count = 0
let promptRequest: unknown
const acpConfig = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "acp-one",
    options: [
      { value: "acp-one", name: "ACP Model One" },
      { value: "acp-two", name: "ACP Model Two" },
    ],
  },
  {
    id: "effort",
    name: "Reasoning",
    category: "thought_level",
    type: "select",
    currentValue: "low",
    options: [
      { value: "low", name: "Low" },
      { value: "high", name: "High" },
    ],
  },
]
const acpUpdate = (update: unknown) =>
  send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "native-session", update } })

if (protocol === "opencode") {
  let events: ServerResponse | undefined
  const emit = (type: string, properties: unknown) => events?.write(`data: ${JSON.stringify({ type, properties })}\n\n`)
  const server = createServer(async (request, response) => {
    if (
      request.headers.authorization !==
      `Basic ${Buffer.from(`codeink:${process.env.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`
    ) {
      response.writeHead(401).end()
      return
    }
    const url = new URL(request.url!, "http://localhost")
    record({ path: url.pathname, protocol })
    if (!url.searchParams.has("directory")) {
      response.writeHead(400).end()
      return
    }
    if (url.pathname === "/provider") {
      response.setHeader("Content-Type", "application/json")
      response.end(
        JSON.stringify({
          connected: ["fixture-provider"],
          default: { "fixture-provider": "model/one" },
          all: [
            {
              id: "fixture-provider",
              name: "Fixture Provider",
              models: {
                "model/one": {
                  id: "model/one",
                  name: "OpenCode Model One",
                  capabilities: { reasoning: true },
                  variants: { high: {}, disabled: { disabled: true } },
                  limit: { context: 200000, output: 32000 },
                  cost: { input: 2, output: 8, cache: { read: 0.2, write: 2.5 } },
                  headers: { Authorization: "must-not-reach-renderer" },
                },
                two: { id: "two", name: "OpenCode Model Two" },
                old: { id: "old", name: "Deprecated", status: "deprecated" },
              },
            },
            {
              id: "disconnected",
              name: "Disconnected",
              models: { hidden: { id: "hidden", name: "Unavailable Model" } },
            },
          ],
        }),
      )
      return
    }
    if (url.pathname === "/config") {
      response.end(JSON.stringify({ model: "fixture-provider/model/one", apiKey: "must-not-reach-renderer" }))
      return
    }
    if (url.pathname === "/event") {
      events = response
      response.writeHead(200, { "Content-Type": "text/event-stream" })
      response.write('data: {"type":"server.connected"}\n\n')
      return
    }
    if (url.pathname === "/session") {
      response.setHeader("Content-Type", "application/json")
      response.end(JSON.stringify({ id: "native-session" }))
      return
    }
    if (url.pathname.endsWith("prompt_async")) {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString())
      record({ path: url.pathname, body, protocol })
      if (!body.parts?.length) {
        response.writeHead(400).end()
        return
      }
      count++
      emit("message.updated", { info: { id: `user-${count}`, sessionID: "native-session", role: "user" } })
      emit("message.part.updated", {
        part: {
          id: `input-${count}`,
          messageID: `user-${count}`,
          sessionID: "native-session",
          type: "text",
          text: body.parts[0].text,
        },
      })
      emit("message.updated", {
        info: {
          id: `assistant-${count}`,
          sessionID: "native-session",
          role: "assistant",
          tokens: { input: 1000, output: 80, reasoning: 20, cache: { read: 200, write: 50 } },
          cost: 0.03,
        },
      })
      emit("message.part.updated", {
        part: { id: `text-${count}`, messageID: `assistant-${count}`, sessionID: "native-session", type: "text", text },
      })
      emit("message.part.updated", {
        part: {
          id: `tool-${count}`,
          messageID: `assistant-${count}`,
          sessionID: "native-session",
          type: "tool",
          tool: "bash",
          state: { status: "running", input: { command: "ls -la" }, title: "List files" },
        },
      })
      emit(process.env.CODEINK_FIXTURE_QUESTION ? "question.asked" : "permission.asked",
        process.env.CODEINK_FIXTURE_QUESTION
          ? { id: "question", sessionID: "native-session", questions: [{ question: "Which option?", options: [{ label: "First" }, { label: "Second" }], multiple: false }] }
          : { id: "permission", sessionID: "native-session", permission: "write", patterns: ["example.ts"] })
      response.writeHead(204).end()
      return
    }
    if (url.pathname === "/permission/permission/reply" || url.pathname === "/question/question/reply" || url.pathname.endsWith("/abort")) {
      if (url.pathname === "/question/question/reply") {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        record({ path: url.pathname, body: JSON.parse(Buffer.concat(chunks).toString()), protocol })
      }
      emit("message.part.updated", {
        part: {
          id: `tool-${count}`,
          messageID: `assistant-${count}`,
          sessionID: "native-session",
          type: "tool",
          tool: "bash",
          state: { status: "completed", input: { command: "ls -la" }, title: "List files", output: "README.md" },
        },
      })
      emit("session.idle", { sessionID: "native-session" })
      response.end("{}")
      return
    }
    response.writeHead(404).end()
  })
  server.listen(0, "127.0.0.1", () => {
    const address = server.address()
    console.log(`server listening on http://127.0.0.1:${typeof address === "object" ? address?.port : 0}`)
  })
} else {
  const parser = new JsonLines()
  process.stdin.on("data", (chunk: Buffer) =>
    parser.push(chunk, (message) => {
      record({ ...message, protocol })
      if (protocol === "acp") {
        const params = object(message.params)
        const result = (result: unknown) => send({ jsonrpc: "2.0", id: message.id, result })
        if (message.method === "initialize") {
          result({
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: process.env.CODEINK_FIXTURE_NO_RESUME !== "1",
              sessionCapabilities: { delete: {} },
            },
          })
          return
        }
        if (message.method === "session/new" || message.method === "session/load") {
          if (message.method === "session/load")
            acpUpdate({
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Previously replayed answer" },
            })
          result({
            sessionId: "native-session",
            ...(process.env.CODEINK_FIXTURE_ACP_LEGACY
              ? {
                  models: {
                    currentModelId: "acp-one",
                    availableModels: [
                      { modelId: "acp-one", name: "ACP Model One" },
                      { modelId: "acp-two", name: "ACP Model Two" },
                    ],
                  },
                }
              : { configOptions: acpConfig }),
          })
          return
        }
        if (message.method === "session/set_config_option") {
          const option = acpConfig.find((option) => option.id === params.configId)
          if (option) option.currentValue = string(params.value)
          result({ configOptions: acpConfig })
          return
        }
        if (message.method === "session/set_model" || message.method === "session/delete") {
          result({})
          return
        }
        if (message.method === "session/prompt") {
          promptRequest = message.id
          count++
          acpUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } })
          acpUpdate({
            sessionUpdate: "tool_call",
            toolCallId: `command-${count}`,
            title: "List files",
            kind: "execute",
            status: "in_progress",
            rawInput: { command: "ls -la" },
          })
          send({
            jsonrpc: "2.0",
            id: 900,
            method: "session/request_permission",
            params: {
              sessionId: "native-session",
              toolCall: { title: "List files", toolCallId: `command-${count}`, rawInput: { command: "ls -la" } },
              options: [
                { optionId: "once", name: "Allow once", kind: "allow_once" },
                { optionId: "always", name: "Always allow", kind: "allow_always" },
                { optionId: "reject", name: "Reject", kind: "reject_once" },
              ],
            },
          })
          return
        }
        if (message.id === 900 || message.method === "session/cancel") {
          acpUpdate({
            sessionUpdate: "tool_call_update",
            toolCallId: `command-${count}`,
            status: "completed",
            rawOutput: "README.md",
          })
          acpUpdate({
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Final answer after tools." },
          })
          acpUpdate({ sessionUpdate: "usage_update", used: 1250, size: 10000, cost: { amount: 0.03, currency: "USD" } })
          send({
            jsonrpc: "2.0",
            id: promptRequest,
            result: { stopReason: message.method === "session/cancel" ? "cancelled" : "end_turn" },
          })
          return
        }
      }
      if (protocol === "codex") {
        const params = object(message.params)
        if (message.method === "initialize") {
          send({ id: message.id, result: { userAgent: "fixture" } })
          return
        }
        if (message.method === "initialized") {
          initialized = true
          return
        }
        if (!initialized) {
          send({ id: message.id, error: { code: -1, message: "Handshake missing" } })
          return
        }
        if (message.method === "model/list") {
          if (process.env.CODEINK_FIXTURE_CATALOG_MODE === "hang") return
          if (process.env.CODEINK_FIXTURE_CATALOG_MODE === "fail") {
            send({ id: message.id, error: { message: "Catalog unavailable" } })
            return
          }
          send({
            id: message.id,
            result: params.cursor
              ? {
                  data: [
                    {
                      id: "fixture-model-two",
                      model: "fixture-model-two",
                      displayName: "Codex Model Two",
                      supportedReasoningEfforts: [{ reasoningEffort: "low" }],
                    },
                  ],
                  nextCursor: null,
                }
              : {
                  data: [
                    {
                      id: "opaque-model-id",
                      model: "fixture-model-one",
                      displayName: "Codex Model One",
                      isDefault: true,
                      supportedReasoningEfforts: [{ reasoningEffort: "medium" }, { reasoningEffort: "high" }],
                    },
                    { id: "hidden", displayName: "Hidden", hidden: true },
                  ],
                  nextCursor: "second-page",
                },
          })
          return
        }
        if (message.method === "thread/start" || message.method === "thread/resume") {
          if (message.method === "thread/resume" && params.threadId !== "native-session") {
            send({ id: message.id, error: { message: "Wrong session" } })
            return
          }
          send({ id: message.id, result: { thread: { id: "native-session" } } })
          return
        }
        if (message.method === "turn/start") {
          count++
          send({ id: message.id, result: { turn: { id: `turn-${count}` } } })
          send({ method: "turn/started", params: { threadId: "native-session", turn: { id: `turn-${count}` } } })
          send({
            method: "item/started",
            params: {
              threadId: "native-session",
              item: { id: `command-${count}`, type: "commandExecution", command: "ls -la", status: "inProgress" },
            },
          })
          if (string(object(array(params.input)[0]).text) === "exit") {
            process.exit(7)
          }
          send({
            method: "item/agentMessage/delta",
            params: { threadId: "native-session", itemId: `text-${count}`, delta: text },
          })
          send({
            method: "item/completed",
            params: { threadId: "native-session", item: { id: `text-${count}`, type: "agentMessage", text } },
          })
          send({
            id: 900,
            method: process.env.CODEINK_FIXTURE_QUESTION ? "item/tool/requestUserInput" : "item/commandExecution/requestApproval",
            params: process.env.CODEINK_FIXTURE_QUESTION
              ? { threadId: "native-session", turnId: `turn-${count}`, itemId: "question", isBlocking: true, questions: [{ id: "choice", header: "Choice", question: "Which option?", options: [{ label: "First", description: "" }, { label: "Second", description: "" }] }] }
              : { threadId: "native-session", command: "echo test", itemId: "command" },
          })
          if (process.env.CODEINK_FIXTURE_QUESTION_ASYNC)
            send({ method: "turn/completed", params: { threadId: "native-session", turn: { id: `turn-${count}`, status: "completed" } } })
          return
        }
        if (message.id === 900 || message.method === "turn/interrupt") {
          send({
            method: "item/completed",
            params: {
              threadId: "native-session",
              item: {
                id: `command-${count}`,
                type: "commandExecution",
                command: "ls -la",
                status: "completed",
                aggregatedOutput: "README.md",
                exitCode: 0,
              },
            },
          })
          if (message.method === "turn/interrupt") send({ id: message.id, result: {} })
          send({
            method: "thread/tokenUsage/updated",
            params: {
              threadId: "native-session",
              turnId: `turn-${count}`,
              tokenUsage: {
                last: {
                  inputTokens: 1200,
                  cachedInputTokens: 200,
                  outputTokens: 100,
                  reasoningOutputTokens: 20,
                  totalTokens: 1300,
                },
                total: { totalTokens: 9000 },
                modelContextWindow: 10000,
              },
            },
          })
          send({
            method: "turn/completed",
            params: { threadId: "native-session", turn: { id: `turn-${count}`, status: "completed" } },
          })
          return
        }
      }
      if (protocol === "claude") {
        const request = object(message.request)
        if (message.type === "control_request") {
          if (request.subtype === "initialize") initialized = true
          send({
            type: "control_response",
            response: {
              subtype: "success",
              request_id: message.request_id,
              response:
                request.subtype === "initialize"
                  ? {
                      models: [
                        {
                          value: "default",
                          displayName: "Claude Default",
                          resolvedModel: "fixture-claude-one",
                          supportsEffort: true,
                          supportedEffortLevels: ["low", "high"],
                        },
                        { value: "fixture-claude-two", displayName: "Claude Model Two" },
                      ],
                    }
                  : {},
            },
          })
          if (request.subtype === "interrupt") send({ type: "result", subtype: "success" })
          return
        }
        if (message.type === "user") {
          if (!initialized) process.exit(8)
          if (process.env.CODEINK_FIXTURE_AUTH_ERROR) {
            const error = "Failed to authenticate: OAuth session expired and could not be refreshed"
            send({
              type: "assistant",
              error: "authentication_failed",
              message: { id: "auth-error", model: "<synthetic>", content: [{ type: "text", text: error }] },
            })
            send({ type: "result", subtype: "success", is_error: true, result: error })
            return
          }
          count++
          send({ type: "system", subtype: "init", session_id: "native-session" })
          send({ type: "stream_event", event: { type: "message_start", message: { id: `text-${count}` } } })
          send({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } })
          send({
            type: "assistant",
            message: {
              id: `text-${count}`,
              usage: {
                input_tokens: 1000,
                output_tokens: 100,
                cache_read_input_tokens: 200,
                cache_creation_input_tokens: 50,
              },
              model: "fixture-claude-two",
              content: [
                { type: "text", text },
                { type: "tool_use", id: `command-${count}`, name: "Bash", input: { command: "ls -la" } },
              ],
            },
          })
          send({
            type: "control_request",
            request_id: "permission",
            request: process.env.CODEINK_FIXTURE_QUESTION
              ? { subtype: "can_use_tool", tool_name: "AskUserQuestion", input: { questions: [{ question: "Which option?", options: [{ label: "First" }, { label: "Second" }], multiSelect: false }] } }
              : { subtype: "can_use_tool", tool_name: "Write", input: { file_path: "example.ts" } },
          })
          return
        }
        if (message.type === "control_response") {
          send({
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: `command-${count}`,
                  content: [{ type: "text", text: "README.md" }],
                },
              ],
            },
          })
          send({
            type: "result",
            subtype: "success",
            result: text,
            total_cost_usd: 0.03,
            modelUsage: { "fixture-claude-two": { contextWindow: 10000 } },
          })
          return
        }
      }
      if (protocol === "pi") {
        if (message.type === "get_available_models") {
          send({
            type: "response",
            id: message.id,
            command: "get_available_models",
            success: true,
            data: {
              models: [
                {
                  id: "pi-one",
                  provider: "fixture-provider",
                  name: "Pi Model One",
                  reasoning: true,
                  contextWindow: 128000,
                  maxTokens: 16000,
                  cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.2 },
                },
                { id: "pi-two", provider: "fixture-provider", name: "Pi Model Two" },
              ],
            },
          })
          return
        }
        if (message.type === "get_state") {
          send({
            type: "response",
            id: message.id,
            command: "get_state",
            success: true,
            data: {
              sessionFile: "native-session",
              isStreaming: streaming,
              model: { id: "pi-one", provider: "fixture-provider" },
            },
          })
          return
        }
        if (message.type === "prompt") {
          if (message.message === "fail") {
            send({ type: "response", id: message.id, success: false, error: "Fixture rejection" })
            return
          }
          streaming = true
          send({
            type: "tool_execution_start",
            toolCallId: "pi-command",
            toolName: "bash",
            args: { command: "ls -la" },
          })
          send({ type: "response", id: message.id, success: true })
          send({ type: "message_start", message: { role: "assistant" } })
          send({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text } })
          send({
            type: "message_end",
            message: {
              role: "assistant",
              content: [{ type: "text", text }],
              usage: {
                input: 1000,
                output: 100,
                reasoning: 20,
                cacheRead: 200,
                cacheWrite: 50,
                totalTokens: 1350,
                cost: { total: 0.03 },
              },
            },
          })
          send(process.env.CODEINK_FIXTURE_QUESTION
            ? { type: "extension_ui_request", id: "permission", method: "select", title: "Which option?", options: ["First", "Second"] }
            : { type: "extension_ui_request", id: "permission", method: "confirm", title: "Approve fixture" })
          return
        }
        if (message.type === "extension_ui_response" || message.type === "abort") {
          streaming = false
          send({ type: "tool_execution_end", toolCallId: "pi-command", toolName: "bash", result: "README.md" })
          if (message.type === "abort") send({ type: "response", id: message.id, success: true })
          send({ type: "agent_end", willRetry: false })
          send({ type: "agent_settled" })
          return
        }
      }
    }),
  )
}
