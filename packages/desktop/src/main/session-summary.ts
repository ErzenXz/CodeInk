import { z } from "zod"
import type { Session } from "../shared/types"

export const sessionSummarySchema = z.object({
  cost: z.number().nonnegative().optional(),
  messages: z.number().int().nonnegative(),
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheRead: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative(),
  attachments: z.array(z.object({ id: z.string().uuid(), filename: z.string(), mime: z.string() })),
})

export type SessionSummary = z.infer<typeof sessionSummarySchema>
export const coldSummaries = new WeakMap<Session, SessionSummary>()

export function sessionSummary(session: Session): SessionSummary {
  const cold = coldSummaries.get(session)
  if (cold) return { ...cold, cost: session.reportedCost ?? cold.cost }
  const summary: SessionSummary = { messages: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, attachments: [] }
  let cost = 0
  let known = true
  session.messages.forEach((message) => {
    if (message.attachments) summary.attachments.push(...message.attachments)
    if (message.role === "user") {
      summary.messages++
      if (!message.costs) known = false
      Object.values(message.costs ?? {}).forEach((amount) => {
        cost += amount
      })
    }
    if (!message.usage) return
    // Adapter token categories are disjoint; cached input and reasoning count once.
    summary.input += (message.usage.input ?? 0) + (message.usage.cacheRead ?? 0) + (message.usage.cacheWrite ?? 0)
    summary.output += (message.usage.output ?? 0) + (message.usage.reasoning ?? 0)
    summary.cacheRead += message.usage.cacheRead ?? 0
    summary.cacheWrite += message.usage.cacheWrite ?? 0
  })
  summary.cost = session.reportedCost ?? (known && summary.messages > 0 ? cost : undefined)
  return summary
}
