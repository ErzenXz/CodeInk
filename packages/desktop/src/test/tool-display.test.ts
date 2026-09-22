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
