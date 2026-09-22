import type { Session } from "../shared/types"
import { expect, test } from "bun:test"
import { legacyMessages } from "../main/bridge"
test("existing saved tool calls keep their real action and details in the original timeline", () => {
  const messages = legacyMessages({
    id: "session",
    agentID: "claude",
    directory: "/tmp",
    title: "test",
    model: "test",
    updatedAt: 1,
    status: "idle",
    approvals: [],
    messages: [
      { id: "user", role: "user", text: "inspect" },
      { id: "tool", role: "tool", text: 'Bash\n{"command":"ls -la"}' },
    ],
  })
  expect(messages[1].parts[0]).toMatchObject({ type: "tool", tool: "bash", state: { input: { command: "ls -la" } } })
})

test("previously stored ACP read inputs retain a visible file path", () => {
  const session: Session = {
    id: "s",
    agentID: "devin",
    directory: "/tmp",
    title: "Read",
    model: "test",
    updatedAt: 1,
    status: "idle",
    approvals: [],
    messages: [
      { id: "u", role: "user", text: "read" },
      {
        id: "t",
        role: "tool",
        text: "20 lines",
        tool: { name: "read", input: { file_path: "/tmp/README.md" }, output: "20 lines", status: "completed" },
      },
    ],
  }
  expect(legacyMessages(session)[1].parts[0]).toMatchObject({
    tool: "read",
    state: { input: { filePath: "/tmp/README.md" } },
  })
})

test("starting a later turn preserves earlier completion times", () => {
  const messages = legacyMessages({
    id: "s",
    agentID: "codex",
    directory: "/tmp",
    title: "Timing",
    model: "test",
    updatedAt: 10000,
    status: "running",
    approvals: [],
    messages: [
      { id: "u1", role: "user", text: "first", createdAt: 100 },
      { id: "a1", role: "assistant", text: "done", createdAt: 200, completedAt: 300 },
      { id: "u2", role: "user", text: "second", createdAt: 10000 },
    ],
  })
  expect(messages[1].info.time).toEqual({ created: 200, completed: 300 })
})
