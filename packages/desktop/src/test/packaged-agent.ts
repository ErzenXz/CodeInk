// Bundled by verify-packaged-agent.ts against the installer's SDK dependencies.
// All model traffic stays on a local fixture; no account keys or paid requests.
import { strict } from "node:assert"
import { createServer } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { codeink } from "../main/adapters/codeink"
import type { AgentEvent } from "../shared/types"

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "codeink-packaged-agent-"))
  const requests: Record<string, unknown>[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    requests.push(JSON.parse(Buffer.concat(chunks).toString()))
    response.setHeader("Content-Type", "text/event-stream")
    const tool = requests.length === 1
    response.end(
      `data: ${JSON.stringify({
        choices: [
          {
            index: 0,
            delta: tool
              ? {
                  tool_calls: [
                    {
                      index: 0,
                      id: "packaged-tool",
                      function: { name: "terminal", arguments: JSON.stringify({ command: "echo PACKAGED_TOOL_OK" }) },
                    },
                  ],
                }
              : { content: "PACKAGED_HELLO" },
          },
        ],
      })}\n\n` +
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
    )
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing local gateway")
  const endpoint = `http://127.0.0.1:${address.port}`
  const events: AgentEvent[] = []
  const adapter = codeink(
    {
      agent: { id: "codeink", name: "CodeInk Agent", protocol: "codeink", command: "builtin", args: [] },
      executable: "builtin",
      directory,
      env: process.env,
      model: "vercel:packaged-model",
      gatewayKey: () => "local-fixture-key",
      rules: () => ({ access: "ask", fast: false }),
      emit(event) {
        events.push(event)
        if (event.type === "approval") void adapter.answer(event.approval.id, { allow: true })
      },
    },
    { vercel: endpoint, openrouter: endpoint },
  )
  try {
    await adapter.prompt("Reply using the local fixture.")
    strict.equal(requests.length, 2)
    strict.equal(requests[0].model, "packaged-model")
    strict.ok(events.some((event) => event.type === "approval"))
    strict.ok(
      events.some(
        (event) =>
          event.type === "tool" &&
          event.tool?.status === "completed" &&
          event.tool.output?.includes("PACKAGED_TOOL_OK"),
      ),
    )
    strict.equal(
      events
        .filter((event) => event.type === "text")
        .map((event) => event.text)
        .join(""),
      "PACKAGED_HELLO",
    )
    strict.deepEqual(events.at(-1), { type: "done" })
    console.log(
      "Packaged CodeInk Agent: SDK loading, approval, terminal execution, and streamed reply passed (zero model usage).",
    )
  } finally {
    adapter.dispose()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
