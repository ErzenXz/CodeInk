import { expect, test } from "bun:test"
import { menuBarModel } from "./menu-bar-model"
import type { AgentUsageReport } from "../shared/types"

test("menu bar keeps running sessions and excludes expired quota windows", () => {
  const now = 20 * 60_000
  const sessions = Array.from({ length: 10 }, (_, index) => ({
    id: String(index),
    title: `Session ${index}`,
    directory: "/project",
    agent: "Claude",
  }))
  const report: AgentUsageReport = {
    agentID: "claude",
    name: "Claude",
    installed: true,
    fetchedAt: 5 * 60_000,
    source: "cache",
    windows: [
      { id: "expired", kind: "session", usedPercent: 70, resetsAt: now - 1 },
      { id: "current", kind: "weekly", usedPercent: 30, resetsAt: now + 1 },
    ],
    totals: { sessions: 0, messages: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
  const model = menuBarModel(sessions, [report], now)

  expect(model.running).toHaveLength(8)
  expect(model.moreRunning).toBe(2)
  expect(model.usage[0]?.windows).toEqual([])
  expect(model.usage[0]?.staleLimits).toBe(true)
  expect(model.usage[0]?.outdated).toBe(true)
  expect(menuBarModel([], [{ ...report, windows: [report.windows[0]!] }], now).usage[0]?.expiredLimits).toBe(true)
  expect(menuBarModel([], [{ ...report, fetchedAt: now }], now).usage[0]?.windows.map((window) => window.id)).toEqual(["current"])
  expect(menuBarModel([], [{ ...report, source: "live" }], now).usage[0]?.staleLimits).toBe(true)
  expect(menuBarModel([], [{ ...report, agentID: "openusage:openrouter", windows: [], metrics: [{ id: "credits", value: 21, unit: "credits" }], fetchedAt: undefined }], now).usage[0]?.metrics).toEqual([{ id: "credits", value: 21, unit: "credits" }])
  expect(menuBarModel([], [{ ...report, fetchedAt: now - 60_000, expiresAt: now - 1, source: "live" }], now).usage[0]?.windows).toEqual([])
  expect(menuBarModel([], [{ ...report, fetchedAt: now - 60_000, expiresAt: now - 1, metrics: [{ id: "credits", value: 21, unit: "credits" }] }], now).usage[0]?.metrics).toEqual([])
})
