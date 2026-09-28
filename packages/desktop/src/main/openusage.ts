import type { AgentLimitWindow, AgentUsageReport } from "../shared/types"
import { object, string } from "./adapters/types"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const run = promisify(execFile)

// OpenUsage is optional. Its loopback API exposes provider usage without exposing credentials.
export async function readOpenUsageReports(base = "http://127.0.0.1:6736"): Promise<AgentUsageReport[]> {
  const response = await fetch(`${base}/v1/limits`, { signal: AbortSignal.timeout(800) })
  if (!response.ok) throw new Error(`OpenUsage HTTP ${response.status}`)
  return parseOpenUsageLimits(await response.json())
}

export async function readOpenUsageCLI(command = "openusage", args: string[] = []) {
  const result = await run(command, args, { timeout: 15_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true })
  return parseOpenUsageLimits(JSON.parse(result.stdout))
}

export function parseOpenUsageLimits(value: unknown): AgentUsageReport[] {
  const payload = object(value)
  if (payload.schema !== "openusage.limits.v1") throw new Error("Invalid OpenUsage limits schema")
  const errors = new Map(
    (Array.isArray(payload.errors) ? payload.errors : [])
      .map(object)
      .filter((item) => string(item.providerId))
      .map((item) => [string(item.providerId), string(item.message)]),
  )
  return Object.entries(object(payload.providers)).flatMap(([id, value]) => {
    const provider = object(value)
    const expiresAt = Date.parse(string(provider.expiresAt))
    const stale = provider.stale === true || (Number.isFinite(expiresAt) && expiresAt <= Date.now())
    const windows = Object.entries(object(provider.resources)).flatMap(([resourceID, value]): AgentLimitWindow[] => {
      const resource = object(value)
      if (resource.kind !== "consumption" || resource.unit !== "percent") return []
      const percent = typeof resource.utilization === "number"
        ? resource.utilization * 100
        : typeof resource.used === "number" && typeof resource.limit === "number" && resource.limit > 0
          ? resource.used / resource.limit * 100
          : undefined
      if (percent === undefined || !Number.isFinite(percent)) return []
      const seconds = typeof resource.windowSeconds === "number" ? resource.windowSeconds : 0
      const kind = resourceID.toLowerCase().includes("weekly") || seconds >= 7 * 24 * 60 * 60
        ? "weekly" : resourceID.toLowerCase().includes("session") || (seconds > 0 && seconds <= 24 * 60 * 60)
          ? "session" : "other"
      const resetsAt = Date.parse(string(resource.resetsAt))
      return [{
        id: resourceID,
        kind,
        usedPercent: percent,
        resetsAt: Number.isFinite(resetsAt) ? resetsAt : undefined,
        label: resourceID === kind ? undefined : resourceID,
      }]
    })
    const metrics = Object.entries(object(provider.resources)).flatMap(([resourceID, value]) => {
      const resource = object(value)
      if (resource.kind === "consumption" && resource.unit === "percent") return []
      const amount = resource.kind === "balance" ? resource.available : resource.used
      if (typeof amount !== "number" || !Number.isFinite(amount)) return []
      return [{ id: resourceID, value: amount, unit: string(resource.unit) }]
    })
    if (!windows.length && !metrics.length && !errors.has(id)) return []
    const fetchedAt = Date.parse(string(provider.fetchedAt))
    return [{
      agentID: `openusage:${id}`,
      name: string(provider.displayName) || id,
      installed: true,
      plan: string(provider.plan) || undefined,
      windows,
      metrics,
      source: stale ? "cache" as const : "live" as const,
      fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : undefined,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
      stale,
      error: errors.get(id) || undefined,
      totals: { sessions: 0, messages: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }]
  })
}
