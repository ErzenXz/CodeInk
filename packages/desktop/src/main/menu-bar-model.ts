import type { AgentUsageReport } from "../shared/types"

export type RunningAgentSession = { id: string; title: string; directory: string; agent: string }

export function menuBarModel(sessions: RunningAgentSession[], reports: AgentUsageReport[], now = Date.now()) {
  return {
    running: sessions.slice(0, 8),
    moreRunning: Math.max(0, sessions.length - 8),
    usage: reports
      .filter((report) => report.windows.length > 0 || !!report.metrics?.length || report.totals.sessions > 0 || report.fetchedAt || report.error)
      .map((report) => {
        const outdated = report.stale === true ||
          (report.expiresAt !== undefined && report.expiresAt <= now) ||
          (report.fetchedAt !== undefined && now - report.fetchedAt >= 10 * 60_000)
        const staleLimits = outdated && report.windows.length > 0
        const windows = staleLimits
          ? []
          : report.windows.filter((window) => !window.resetsAt || window.resetsAt > now).slice(0, 4)
        return {
          ...report,
          windows,
          metrics: outdated ? [] : report.metrics,
          staleLimits,
          expiredLimits: report.source === "cache" && report.windows.length > 0 && windows.length === 0,
          outdated,
        }
      }),
  }
}
