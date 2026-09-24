import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startBridge } from "../src/main/bridge"
import type { Session } from "../src/shared/types"

const directory = await mkdtemp(join(tmpdir(), "codeink-conversation-bench-"))
const turns = Number(process.env.CODEINK_BENCH_TURNS ?? 2000)
const session: Session = {
  id: "benchmark-session",
  agentID: "codex",
  directory,
  title: "Benchmark",
  model: "default",
  updatedAt: Date.now(),
  status: "idle",
  approvals: [],
  messages: Array.from({ length: turns }, (_, index) => [
    { id: `user-${index}`, role: "user" as const, text: `Prompt ${index}` },
    { id: `tool-${index}`, role: "tool" as const, text: "x".repeat(1024), tool: { name: "bash", output: "x".repeat(1024) } },
    { id: `answer-${index}`, role: "assistant" as const, text: `Answer ${index}` },
  ]).flat(),
}
const bridge = await startBridge("127.0.0.1", 0, "benchmark-password", directory, process.env)
try {
  bridge.store.state.sessions.push(session)
  const address = bridge.server.address()
  if (!address || typeof address === "string") throw new Error("No listener")
  const headers = { Authorization: `Basic ${Buffer.from("opencode:benchmark-password").toString("base64")}` }
  const url = `http://127.0.0.1:${address.port}/session/${session.id}/message?directory=${encodeURIComponent(directory)}&limit=20`
  const start = performance.now()
  const response = await fetch(url, { headers })
  const body = await response.text()
  const elapsedMs = performance.now() - start
  const messages = JSON.parse(body)
  bridge.store.state.sessions.push(...Array.from({ length: 200 }, (_, index) => ({
    ...session,
    id: `sidebar-${index}`,
    messages: session.messages.slice(0, 300),
  })))
  const listStart = performance.now()
  const listBody = await fetch(`http://127.0.0.1:${address.port}/session?directory=${encodeURIComponent(directory)}&limit=10`, { headers }).then((result) => result.text())
  console.log(JSON.stringify({ turns, elapsedMs, responseBytes: Buffer.byteLength(body), returnedMessages: messages.length, nextCursor: response.headers.get("x-next-cursor"), listElapsedMs: performance.now() - listStart, listBytes: Buffer.byteLength(listBody), listedSessions: JSON.parse(listBody).length }))
} finally {
  await bridge.stop()
  await rm(directory, { recursive: true, force: true })
}
