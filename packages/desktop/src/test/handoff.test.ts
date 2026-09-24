import { expect, test } from "bun:test"
import { handoffContext } from "../main/handoff"
import type { Session } from "../shared/types"

test("handoff favors recent turns and never copies tool output", () => {
  const source: Session = {
    id: "ses_claude", agentID: "claude", directory: "/repo", title: "Source", model: "model",
    updatedAt: 1, status: "idle", approvals: [],
    messages: Array.from({ length: 30 }, (_, index) => [
      { id: `user-${index}`, role: "user" as const, text: `Request ${index}: ${"x".repeat(2500)}` },
      { id: `tool-${index}`, role: "tool" as const, text: "PRIVATE_TOOL_OUTPUT".repeat(1000), tool: { name: "bash", output: "PRIVATE_TOOL_OUTPUT".repeat(1000) } },
      { id: `answer-${index}`, role: "assistant" as const, text: `Completed request ${index}` },
    ]).flat(),
  }
  const context = handoffContext(source)
  expect(context).toContain("Request 29")
  expect(context).toContain("Completed request 29")
  expect(context).not.toContain("Request 0")
  expect(context).not.toContain("PRIVATE_TOOL_OUTPUT")
  expect(context.length).toBeLessThan(12_100)
})
