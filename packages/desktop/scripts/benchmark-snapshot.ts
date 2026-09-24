import { createHash } from "node:crypto"
import { legacyMessages } from "../src/main/bridge"
import type { Session } from "../src/shared/types"

const session: Session = {
  id: "benchmark-session", agentID: "codex", directory: "/benchmark", title: "Benchmark", model: "default",
  updatedAt: Date.now(), status: "running", approvals: [],
  messages: Array.from({ length: Number(process.env.CODEINK_BENCH_MESSAGES ?? 10000) }, (_, index) => ({
    id: `message-${index}`, role: index % 12 === 0 ? "user" as const : "assistant" as const,
    text: "x".repeat(1024) + index,
  })),
}

Bun.gc(true)
const before = process.memoryUsage().heapUsed
const start = performance.now()
const snapshots = new Map<string, string>()
const signature = (value: unknown) => {
  const serialized = JSON.stringify(value)
  return process.env.CODEINK_BENCH_HASH === "1" ? createHash("sha256").update(serialized).digest("hex").slice(0, 24) : serialized
}
for (const message of legacyMessages(session)) {
  snapshots.set(message.info.id, signature(message.info))
  for (const part of message.parts) snapshots.set(part.id, signature(part))
}
Bun.gc(true)
console.log(JSON.stringify({ messages: session.messages.length, snapshots: snapshots.size, elapsedMs: performance.now() - start, retainedHeapBytes: process.memoryUsage().heapUsed - before }))
