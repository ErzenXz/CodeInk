// Local protocol peer for the manual concurrency benchmark; never calls a model.
import { JsonLines } from "../../main/adapters/process"
import { object, string } from "../../main/adapters/types"

const protocol = process.argv[2]
const send = (message: unknown) => process.stdout.write(JSON.stringify(message) + "\n")
const stream = async () => {
  for (let index = 0; index < 100; index++) {
    const text = `${index}:` + "x".repeat(1024)
    if (protocol === "codex")
      send({
        method: "item/agentMessage/delta",
        params: {
          threadId: "local-thread",
          itemId: "reply",
          delta: text,
        },
      })
    if (protocol === "claude")
      send({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text },
        },
      })
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  if (protocol === "codex")
    send({
      method: "turn/completed",
      params: {
        threadId: "local-thread",
        turn: { id: "local-turn", status: "completed" },
      },
    })
  if (protocol === "claude") send({ type: "result", subtype: "success", session_id: "local-thread", result: "done" })
}
const parser = new JsonLines()
process.stdin.on("data", (chunk: Buffer) =>
  parser.push(chunk, (message) => {
    if (protocol === "codex") {
      if (message.method === "initialize") return send({ id: message.id, result: { userAgent: "fixture" } })
      if (message.method === "thread/start") return send({ id: message.id, result: { thread: { id: "local-thread" } } })
      if (message.method === "turn/start") {
        send({ id: message.id, result: { turn: { id: "local-turn" } } })
        send({ method: "turn/started", params: { threadId: "local-thread", turn: { id: "local-turn" } } })
        void stream()
      }
      if (message.method === "turn/interrupt") send({ id: message.id, result: {} })
      return
    }
    if (message.type === "control_request")
      return send({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: message.request_id,
          response: {},
        },
      })
    if (message.type !== "user" || !string(object(message.message).role)) return
    send({ type: "system", subtype: "init", session_id: "local-thread" })
    send({ type: "stream_event", event: { type: "message_start", message: { id: "reply" } } })
    send({
      type: "stream_event",
      event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    })
    void stream()
  }),
)
