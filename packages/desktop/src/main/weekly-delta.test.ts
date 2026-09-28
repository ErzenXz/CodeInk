import { expect, test } from "bun:test"
import { weeklyDelta } from "./weekly-delta"
import { legacyMessages } from "./bridge"
import type { Session } from "../shared/types"

test("weekly meter change reports percentage points within the same window", () => {
  expect(weeklyDelta(
    { id: "weekly", usedPercent: 18.07, resetsAt: 100 },
    { id: "weekly", usedPercent: 19.19, resetsAt: 100 },
  )).toBe(1.12)
  expect(weeklyDelta(
    { id: "weekly", usedPercent: 99, resetsAt: 100 },
    { id: "weekly", usedPercent: 1, resetsAt: 200 },
  )).toBeUndefined()
  expect(weeklyDelta(
    { id: "weekly", usedPercent: 10, resetsAt: 100 },
    { id: "other", usedPercent: 12, resetsAt: 100 },
  )).toBeUndefined()
})

test("the observed weekly change reaches the assistant reply metadata", () => {
  const session: Session = {
    id: "session",
    agentID: "claude",
    directory: "/tmp",
    title: "Example",
    model: "opus",
    messages: [
      { id: "user", role: "user", text: "Hello", createdAt: 100, weeklyDelta: 1.12 },
      { id: "reply", role: "assistant", text: "Hi", createdAt: 101, completedAt: 102 },
    ],
    updatedAt: 102,
    status: "idle",
    approvals: [],
  }
  const reply = legacyMessages(session).find((item) => item.info.role === "assistant")
  expect((reply?.info as { codeinkWeeklyDelta?: number })?.codeinkWeeklyDelta).toBe(1.12)
})
