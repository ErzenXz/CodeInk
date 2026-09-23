import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WorkspaceStore } from "../src/main/agent-store"

const directory = await mkdtemp(join(tmpdir(), "codeink-store-bench-"))
const store = new WorkspaceStore(join(directory, "agents.json"))
store.state.sessions = Array.from({ length: 24 }, (_, session) => ({
  id: `session-${session}`,
  agentID: "codex",
  directory,
  title: `Agent ${session}`,
  model: "default",
  updatedAt: Date.now(),
  status: "running" as const,
  approvals: [],
  messages: Array.from({ length: 120 }, (_, message) => ({
    id: `message-${session}-${message}`,
    role: "assistant" as const,
    text: "x".repeat(1024),
  })),
}))

try {
  await store.save()
  const start = performance.now()
  const timer = new Promise<number>((resolve) => setTimeout(() => resolve(performance.now() - start), 0))
  const saves = Array.from({ length: 24 }, () => store.save())
  const enqueueMs = performance.now() - start
  const timerDelayMs = await timer
  await Promise.all(saves)
  console.log(JSON.stringify({ sessions: 24, messagesPerSession: 120, saves: 24, enqueueMs, timerDelayMs, totalMs: performance.now() - start }))
} finally {
  await rm(directory, { recursive: true, force: true })
}
