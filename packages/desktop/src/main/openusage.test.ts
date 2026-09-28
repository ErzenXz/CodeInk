import { expect, test } from "bun:test"
import { parseOpenUsageLimits, readOpenUsageCLI, readOpenUsageReports } from "./openusage"

test("OpenUsage provider resources map to weekly limits without treating balances as quotas", async () => {
  const names = ["antigravity", "claude", "codex", "copilot", "cursor", "devin", "grok", "ollama", "opencode", "openrouter", "zai"]
  const server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({
        schema: "openusage.limits.v1",
        providers: Object.fromEntries(names.map((name) => [name, {
          displayName: name,
          fetchedAt: new Date().toISOString(),
          resources: name === "openrouter"
            ? { credits: { kind: "balance", unit: "credits", available: 21 } }
            : {
                weekly: { kind: "consumption", unit: "percent", used: 1.12, limit: 100, utilization: 0.0112, windowSeconds: 604800 },
                credits: { kind: "balance", unit: "credits", available: 21 },
              },
        }])),
      })
    },
  })
  try {
    const reports = await readOpenUsageReports(`http://127.0.0.1:${server.port}`)
    expect(reports).toHaveLength(11)
    expect(reports.filter((report) => report.windows[0]?.kind === "weekly")).toHaveLength(10)
    expect(reports[0].windows[0].usedPercent).toBeCloseTo(1.12)
    expect(reports[0].metrics).toEqual([{ id: "credits", value: 21, unit: "credits" }])
    expect(reports.find((report) => report.agentID === "openusage:openrouter")?.metrics).toEqual([{ id: "credits", value: 21, unit: "credits" }])
  } finally {
    server.stop(true)
  }
})

test("OpenUsage expiry and refresh errors remain visible without marking old limits live", () => {
  const reports = parseOpenUsageLimits({
    schema: "openusage.limits.v1",
    providers: {
      "claude:account": {
        displayName: "Claude Account",
        fetchedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        stale: true,
        resources: {
          weekly: { kind: "consumption", unit: "percent", utilization: 0.4, windowSeconds: 604800 },
        },
      },
    },
    errors: [{ providerId: "claude:account", message: "Refresh failed" }],
  })
  expect(reports[0]).toMatchObject({
    agentID: "openusage:claude:account",
    source: "cache",
    stale: true,
    error: "Refresh failed",
  })
  expect(reports[0].windows[0].usedPercent).toBe(40)
})

test("OpenUsage command-line helper uses the same limits envelope", async () => {
  const payload = JSON.stringify({
    schema: "openusage.limits.v1",
    providers: {
      opencode: {
        displayName: "OpenCode",
        fetchedAt: new Date().toISOString(),
        resources: { weekly: { kind: "consumption", unit: "percent", used: 30, limit: 100, windowSeconds: 604800 } },
      },
    },
  })
  const reports = await readOpenUsageCLI(process.execPath, ["-e", `process.stdout.write(${JSON.stringify(payload)})`])
  expect(reports[0]).toMatchObject({ agentID: "openusage:opencode", source: "live" })
  expect(reports[0].windows[0].usedPercent).toBe(30)
})
