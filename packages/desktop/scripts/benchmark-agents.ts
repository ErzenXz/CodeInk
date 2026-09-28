import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "node:http"
import { WorkspaceStore } from "../src/main/agent-store"
import { Sessions } from "../src/main/sessions"
import { connectAgent } from "../src/main/agents"
import { codeink } from "../src/main/adapters/codeink"
import type { Session } from "../src/shared/types"

const live = process.env.CODEINK_LIVE_HELLO === "1"
const directory = await mkdtemp(join(tmpdir(), "codeink-agent-bench-"))
if (!live) {
  const seed = new WorkspaceStore(join(directory, "agents.json"))
  seed.state.sessions = Array.from({ length: 100 }, (_, session) => ({
    id: `saved-history-${session}`,
    agentID: "codex",
    directory,
    title: "Saved benchmark chat",
    model: "",
    updatedAt: session,
    status: "idle",
    approvals: [],
    messages: Array.from({ length: 100 }, (_, message) => ({
      id: `saved-${session}-${message}`,
      role: message % 10 === 0 ? "user" : "assistant",
      text: `${session}:${message}:` + "x".repeat(4096),
    })),
  }))
  await seed.save()
}
const store = new WorkspaceStore(join(directory, "agents.json"))
await store.load()
const saved = new Set(store.state.sessions.map((session) => session.id))
Bun.gc(true)
const server = createServer(async (_request, response) => {
  response.setHeader("Content-Type", "text/event-stream")
  for (let index = 0; index < 100; index++) {
    response.write(
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: `${index}:` + "x".repeat(1024) } }] })}\n\n`,
    )
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  response.end(
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
  )
})
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
const address = server.address()
if (!address || typeof address === "string") throw new Error("Missing local gateway")
const endpoint = `http://127.0.0.1:${address.port}`
const observations = new Map<string, { firstTextMs?: number; doneMs?: number }>()
const timing = { start: performance.now(), activePeak: 0, timerAt: performance.now() }
const gaps: number[] = []
const timer = setInterval(() => {
  const now = performance.now()
  gaps.push(now - timing.timerAt)
  timing.timerAt = now
}, 10)
const publish = (session: Session) => {
  const observation = observations.get(session.id) ?? {}
  if (
    observation.firstTextMs === undefined &&
    session.messages
      .slice(session.messages.findLastIndex((message) => message.role === "user") + 1)
      .some((message) => message.role === "assistant" && message.text)
  )
    observation.firstTextMs = performance.now() - timing.start
  if (session.status !== "running") observation.doneMs ??= performance.now() - timing.start
  observations.set(session.id, observation)
  timing.activePeak = Math.max(
    timing.activePeak,
    store.state.sessions.filter((item) => item.status === "running").length,
  )
}
const sessions = new Sessions(
  store,
  process.env,
  publish,
  undefined,
  () => "local-test-key",
  (options) =>
    options.agent.protocol === "codeink"
      ? codeink(options, { vercel: endpoint, openrouter: endpoint })
      : connectAgent(options),
)

try {
  store.state.agents = ["codex", "claude", ...(live ? [] : ["codeink"])].map((protocol) => ({
    id: protocol,
    name: protocol,
    protocol: protocol as "codex" | "claude" | "codeink",
    command: live ? protocol : process.execPath,
    args:
      live || protocol === "codeink"
        ? []
        : [join(import.meta.dirname, "../src/test/fixtures/stream-agent.ts"), protocol],
  }))
  store.state.agentRules = Object.fromEntries(
    store.state.agents.map((agent) => [agent.id, { access: "ask", fast: false }]),
  )
  const requested = store.state.agents.flatMap((agent) =>
    Array.from({ length: live ? 1 : 4 }, () => ({
      agentID: agent.id,
      directory,
      model: agent.id === "codeink" ? "vercel:local-model" : "",
      text: live
        ? "Reply with only HELLO. Do not use any tools, inspect files, or perform any other work."
        : "Local streaming benchmark",
    })),
  )
  for (const wave of live ? [0] : [0, 1]) {
    timing.start = performance.now()
    timing.timerAt = timing.start
    timing.activePeak = 0
    gaps.length = 0
    observations.clear()
    await Promise.all(
      (wave === 0
        ? requested
        : store.state.sessions
            .filter((session) => !saved.has(session.id))
            .map((session) => ({
              agentID: session.agentID,
              directory,
              model: session.model,
              sessionID: session.id,
              text: "Local streaming benchmark",
            }))
      ).map((input) => sessions.send(input, false)),
    )
    const deadline = performance.now() + (live ? 90_000 : 30_000)
    while (store.state.sessions.some((session) => session.status === "running")) {
      if (performance.now() > deadline) throw new Error("Agent benchmark completion timed out")
      for (const session of store.state.sessions) {
        for (const approval of session.approvals) await sessions.answer(session.id, approval.id, { allow: false })
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    await store.save()
    const sorted = gaps.toSorted((a, b) => a - b)
    console.log(
      JSON.stringify({
        mode: live ? "two-live-hello-requests" : "local-no-model-usage",
        wave: wave === 0 ? "cold" : "warm",
        sessions: requested.length,
        savedHistories: saved.size,
        activePeak: timing.activePeak,
        elapsedMs: performance.now() - timing.start,
        timerGapP95Ms: sorted[Math.floor(sorted.length * 0.95)],
        timerGapMaxMs: sorted.at(-1),
        results: store.state.sessions
          .filter((session) => !saved.has(session.id))
          .map((session) => ({
            agent: session.agentID,
            status: session.status,
            replyChars: session.messages
              .filter((message) => message.role === "assistant")
              .reduce((sum, message) => sum + message.text.length, 0),
            ...observations.get(session.id),
          })),
      }),
    )
    if (
      store.state.sessions.some(
        (session) =>
          session.status === "error" ||
          !session.messages.some((message) => message.role === "assistant" && message.text),
      )
    )
      throw new Error("One or more agents did not complete with a reply")
  }
  const restored = new WorkspaceStore(join(directory, "agents.json"))
  await restored.load()
  if (
    restored.state.sessions.length !== requested.length + saved.size ||
    restored.state.sessions.some((session) => !session.messages.some((message) => message.role === "assistant"))
  )
    throw new Error("Concurrent histories were not retained")
} finally {
  clearInterval(timer)
  await sessions.dispose()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(directory, { recursive: true, force: true })
}
