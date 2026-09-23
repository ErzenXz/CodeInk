import { expect, test } from "bun:test"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { connectAgent } from "../main/agents"
import type { AgentEvent } from "../shared/types"
test("Claude expired login produces one actionable error without an assistant echo", async () => {
  const events: AgentEvent[] = []
  const finished = Promise.withResolvers<void>()
  const adapter = connectAgent({
    agent: {
      id: "claude",
      name: "Claude Code",
      protocol: "claude",
      command: process.execPath,
      args: [join(import.meta.dirname, "fixtures/agent.ts"), "claude"],
    },
    executable: process.execPath,
    directory: tmpdir(),
    env: { ...process.env, CODEINK_FIXTURE_AUTH_ERROR: "1" },
    rules: () => ({ access: "ask" as const, fast: false }),
    model: "haiku",
    emit(event) {
      events.push(event)
      if (event.type === "error") finished.resolve()
    },
  })
  try {
    await adapter.prompt("hello")
    await finished.promise
    expect(events.filter((event) => event.type === "text")).toEqual([])
    expect(events.filter((event) => event.type === "error")).toEqual([
      { type: "error", text: expect.stringContaining("claude auth login") },
    ])
  } finally {
    adapter.dispose()
  }
})
