// Measures protocol initialization only; does not submit a model turn.
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AgentProcess } from "../src/main/adapters/process"
import { resolveExecutable } from "../src/main/agents"

const directory = await mkdtemp(join(tmpdir(), "codeink-startup-bench-"))
try {
  await Promise.all(
    ["codex", "claude"].map(async (agent) => {
      const executable = await resolveExecutable(agent, process.env)
      if (!executable) throw new Error("Missing benchmark agent")
      const start = performance.now()
      const peer = new AgentProcess({
        executable,
        directory,
        env: { ...Bun.env },
        args:
          agent === "codex"
            ? ["app-server"]
            : [
                "--print",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--verbose",
                "--include-partial-messages",
                "--permission-prompt-tool",
                "stdio",
              ],
        message: () => {},
        error: () => {},
      })
      try {
        await peer.request(
          (id) =>
            agent === "codex"
              ? {
                  id,
                  method: "initialize",
                  params: {
                    clientInfo: { name: "codeink", title: "CodeInk", version: "0.1.0" },
                    capabilities: { experimentalApi: true },
                  },
                }
              : { type: "control_request", request_id: id, request: { subtype: "initialize", hooks: {} } },
          30_000,
        )
        console.log(JSON.stringify({ agent, initializeMs: performance.now() - start, modelTurns: 0 }))
      } finally {
        peer.dispose()
      }
    }),
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
