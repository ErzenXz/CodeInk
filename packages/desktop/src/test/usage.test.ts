import { expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WorkspaceStore } from "../main/agent-store"
import { Sessions } from "../main/sessions"
import { legacyMessages, legacySession } from "../main/bridge"
import { removeFixture } from "./fixtures/cleanup"

async function eventually(check: () => boolean) {
  const deadline = Date.now() + 5000
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

for (const protocol of ["codex", "claude", "opencode", "pi", "acp"] as const) {
  test(`${protocol}: persists real usage, preserves tool order, and makes message retries idempotent`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "codeink-usage-"))
    const path = join(directory, "agents.json")
    const store = new WorkspaceStore(path)
    store.state.agents = [
      {
        id: protocol,
        name: protocol,
        protocol,
        command: process.execPath,
        args: [join(import.meta.dirname, "fixtures/agent.ts"), protocol],
      },
    ]
    const sessions = new Sessions(store, process.env, () => {})
    try {
      const input = { messageID: "msg_retry", agentID: protocol, directory, model: "", text: "hello" }
      const session = await sessions.send(input)
      await eventually(() => sessions.get(session.id).approvals.length > 0)
      await sessions.send({ ...input, sessionID: session.id })
      await sessions.answer(session.id, sessions.get(session.id).approvals[0].id, { allow: true })
      await eventually(() => sessions.get(session.id).status === "idle")
      await sessions.send({ ...input, sessionID: session.id })
      await expect(sessions.send({ ...input, sessionID: session.id, text: "different" })).rejects.toThrow(
        "different request",
      )
      const current = sessions.get(session.id)
      expect(current.messages.filter((message) => message.role === "user")).toHaveLength(1)
      const usage = current.messages[0].usage
      expect(usage).toBeDefined()
      if (protocol === "acp") {
        expect(usage?.contextUsed).toBe(1250)
        expect(usage?.input).toBeUndefined()
        expect(legacyMessages(current)[1].parts.map((part) => part.type)).toEqual(["text", "tool", "text"])
      } else {
        expect(usage?.input).toBe(1000)
        expect(usage?.cacheRead).toBe(200)
        expect(usage?.total).toBe(protocol === "codex" ? 1300 : 1350)
      }
      expect(legacySession(current).cost).toBe(protocol === "codex" ? 0 : 0.03)
      if (protocol === "codex") expect(usage?.reasoning).toBe(20)
      await store.save()
      const restored = new WorkspaceStore(path)
      await restored.load()
      expect(restored.state.sessions[0].messages[0].usage).toEqual(usage)
    } finally {
      await sessions.dispose()
      await removeFixture(directory)
    }
  })
}
