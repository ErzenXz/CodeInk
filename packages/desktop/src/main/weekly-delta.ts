export type WeeklySnapshot = { id: string; usedPercent: number; resetsAt?: number }

export function weeklyDelta(before?: WeeklySnapshot, after?: WeeklySnapshot) {
  if (!before || !after || before.id !== after.id || before.resetsAt !== after.resetsAt) return
  const delta = after.usedPercent - before.usedPercent
  if (!Number.isFinite(delta) || delta < 0 || delta > 100) return
  return Math.round(delta * 100) / 100
}
