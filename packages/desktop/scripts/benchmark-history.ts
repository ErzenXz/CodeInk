import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WorkspaceStore } from "../src/main/agent-store"
import { legacySession } from "../src/main/bridge"

declare const gc: () => void

if (process.argv[2]) {
  const collect = typeof Bun === "undefined" ? gc : () => Bun.gc(true)
  collect()
  const before = process.memoryUsage()
  const start = performance.now()
  const store = new WorkspaceStore(process.argv[2])
  await store.load()
  const loadMs = performance.now() - start
  const list = performance.now()
  store.state.sessions.map(legacySession)
  const listMs = performance.now() - list
  collect()
  const loaded = process.memoryUsage()
  store.state.sessions[0].messages.push({ id: "new", role: "assistant", text: "New reply" })
  const save = performance.now()
  const timer = new Promise<number>((resolve) => setTimeout(() => resolve(performance.now() - save), 0))
  await store.save()
  console.log(
    JSON.stringify({
      sessions: store.state.sessions.length,
      loadMs,
      listMs,
      retainedHeapBytes: loaded.heapUsed - before.heapUsed,
      rssGrowthBytes: loaded.rss - before.rss,
      saveMs: performance.now() - save,
      timerDelayMs: await timer,
    }),
  )
} else {
  const directory = await mkdtemp(join(tmpdir(), "codeink-history-bench-"))
  try {
    const path = join(directory, "agents.json")
    const store = new WorkspaceStore(path)
    store.state.sessions = Array.from({ length: 100 }, (_, session) => ({
      id: `session-${session}`,
      agentID: "codex",
      directory,
      title: `Chat ${session}`,
      model: "default",
      updatedAt: session,
      status: "idle" as const,
      approvals: [],
      messages: Array.from({ length: 100 }, (_, message) => ({
        id: `message-${session}-${message}`,
        role: message % 10 === 0 ? ("user" as const) : ("assistant" as const),
        text: Array.from(
          { length: 64 },
          (_, line) => `session=${session} message=${message} line=${line}: example source code and tool output\n`,
        ).join(""),
      })),
    }))
    await store.save()
    const command =
      process.env.CODEINK_BENCH_NODE === "1"
        ? ["node", "--expose-gc", join(directory, "benchmark.js"), path]
        : [process.execPath, import.meta.path, path]
    if (process.env.CODEINK_BENCH_NODE === "1") {
      const build = await Bun.build({
        entrypoints: [import.meta.path],
        target: "node",
        outdir: directory,
        naming: "benchmark.js",
      })
      if (!build.success) throw new AggregateError(build.logs, "Benchmark build failed")
    }
    const child = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" })
    if (await child.exited) throw new Error("History benchmark failed")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
