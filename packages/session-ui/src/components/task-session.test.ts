import { expect, test } from "bun:test"
import { taskResult, taskSessionTarget } from "./task-session"

test("a remote task ID does not link to a missing local session", () => {
  expect(taskSessionTarget("ses_remote_child", [{ id: "ses_local_parent" }])).toBeUndefined()
})

test("a task with a stored child keeps its session link", () => {
  expect(taskSessionTarget("ses_local_child", [{ id: "ses_local_child" }])).toBe("ses_local_child")
})

test("a completed remote task can show its result without a child session", () => {
  expect(taskResult('<task id="ses_remote_child"><task_result>Found the issue.</task_result></task>')).toBe(
    "Found the issue.",
  )
})
