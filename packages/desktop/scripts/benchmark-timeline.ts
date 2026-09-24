import { legacyMessages } from "../src/main/bridge"
import type { Session } from "../src/shared/types"

const session: Session = {
  id: "benchmark-session",
  agentID: "codex",
  directory: "/benchmark",
  title: "Benchmark",
  model: "default",
  updatedAt: Date.now(),
  status: "running",
  approvals: [],
  messages: Array.from({ length: Number(process.env.CODEINK_BENCH_MESSAGES ?? 120) }, (_, index) => ({
    id: `message-${index}`,
    role: index % 12 === 0 ? "user" as const : "assistant" as const,
    text: "x".repeat(1024),
  })),
}

const startIndex = process.env.CODEINK_BENCH_TAIL === "1" ? session.messages.findLastIndex((message) => message.role === "user") : 0
for (let i = 0; i < 10; i++) legacyMessages(session, undefined, startIndex)
const start = performance.now()
const projections = Number(process.env.CODEINK_BENCH_PROJECTIONS ?? 1000)
for (let i = 0; i < projections; i++) legacyMessages(session, undefined, startIndex)
console.log(JSON.stringify({ messages: session.messages.length, projectedMessages: session.messages.length - startIndex, projections, elapsedMs: performance.now() - start }))
