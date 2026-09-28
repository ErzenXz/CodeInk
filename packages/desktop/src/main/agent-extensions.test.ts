import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readAgentUsage, readAgentWeeklyLimit } from "./agent-extensions"
import type { Session } from "../shared/types"

test("usage includes cached input and reasoning output without double counting", async () => {
  const sessions: Session[] = [
    {
      id: "one",
      agentID: "example",
      directory: "/tmp",
      title: "Example",
      model: "model",
      messages: [
        {
          id: "request",
          role: "user",
          text: "Hello",
          usage: { input: 10, cacheRead: 20, cacheWrite: 5, output: 3, reasoning: 2 },
        },
      ],
      updatedAt: 100,
      status: "idle",
      approvals: [],
    },
  ]
  const [report] = await readAgentUsage(
    [{ id: "example", name: "Example", protocol: "acp", command: "example", args: [] }],
    sessions,
    {},
    true,
  )

  expect(report?.totals).toEqual({
    sessions: 1,
    messages: 1,
    input: 35,
    output: 5,
    cacheRead: 20,
    cacheWrite: 5,
    lastUsed: 100,
  })
})

test("failed usage refresh keeps the last good Claude limit snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-usage-"))
  const agent = { id: directory, name: "Claude Code", protocol: "claude" as const, command: "claude", args: [], executable: "claude" }
  try {
    await writeFile(join(directory, ".claude.json"), JSON.stringify({
      cachedUsageUtilization: {
        fetchedAtMs: Date.now(),
        utilization: { five_hour: { utilization: 37, resets_at: new Date(Date.now() + 60_000).toISOString() } },
      },
    }))
    const [first] = await readAgentUsage([agent], [], { CLAUDE_CONFIG_DIR: directory }, true)
    expect(await readAgentWeeklyLimit(agent, { CLAUDE_CONFIG_DIR: directory })).toBeUndefined()
    await writeFile(join(directory, ".claude.json"), "broken json")
    const [second] = await readAgentUsage([agent], [], { CLAUDE_CONFIG_DIR: directory }, true)

    expect(first?.windows[0]?.usedPercent).toBe(37)
    expect(second?.windows).toEqual(first?.windows)
    expect(second?.fetchedAt).toBe(first?.fetchedAt)
    expect(second?.error).toBeTruthy()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("Claude usage prefers a live account response over a stale local snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-usage-live-"))
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      expect(new URL(request.url).pathname).toBe("/api/oauth/usage")
      expect(request.headers.get("authorization")).toBe("Bearer fixture-token")
      return Response.json({
        five_hour: { utilization: 14, resets_at: "2026-09-24T19:00:00Z" },
        seven_day: { utilization: 42.12, resets_at: "2026-09-28T19:00:00Z" },
        limits: [{ kind: "weekly_scoped", percent: 12.4, scope: { model: { display_name: "Sonnet" } } }],
      })
    },
  })
  const agent = { id: directory, name: "Claude Code", protocol: "claude" as const, command: "claude", args: [], executable: "claude" }
  try {
    await writeFile(join(directory, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "fixture-token" } }))
    await writeFile(join(directory, ".claude.json"), JSON.stringify({
      cachedUsageUtilization: {
        fetchedAtMs: Date.now() - 20 * 60_000,
        utilization: { seven_day: { utilization: 37, resets_at: "2026-09-28T19:00:00Z" } },
      },
    }))
    const [report] = await readAgentUsage([agent], [], {
      CLAUDE_CONFIG_DIR: directory,
      CLAUDE_CODE_CUSTOM_OAUTH_URL: `http://127.0.0.1:${server.port}`,
    }, true)
    expect(report?.source).toBe("live")
    expect(report?.windows.find((window) => window.id === "seven_day")?.usedPercent).toBe(42.12)
    expect(report?.windows.find((window) => window.label === "Sonnet")?.usedPercent).toBe(12.4)
  } finally {
    server.stop(true)
    await rm(directory, { recursive: true, force: true })
  }
})

test("Claude usage reads a hex-encoded stored login", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codeink-usage-hex-"))
  const server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({ seven_day: { utilization: "8.75", resets_at: "2026-09-28T19:00:00Z" } })
    },
  })
  try {
    const credentials = JSON.stringify({ claudeAiOauth: { accessToken: "fixture-token" } })
    await writeFile(join(directory, ".credentials.json"), `0x${Buffer.from(credentials).toString("hex")}`)
    const agent = { id: directory, name: "Claude Code", protocol: "claude" as const, command: "claude", args: [], executable: "claude" }
    const [report] = await readAgentUsage([agent], [], {
      CLAUDE_CONFIG_DIR: directory,
      CLAUDE_CODE_CUSTOM_OAUTH_URL: `http://127.0.0.1:${server.port}`,
    }, true)
    expect(report?.windows.find((window) => window.kind === "weekly")?.usedPercent).toBe(8.75)
  } finally {
    server.stop(true)
    await rm(directory, { recursive: true, force: true })
  }
})
