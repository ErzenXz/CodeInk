export function taskSessionTarget(id: unknown, sessions: readonly { id: string }[] | undefined) {
  if (typeof id !== "string" || !id) return
  return sessions?.some((session) => session.id === id) ? id : undefined
}

export function taskResult(output: string | undefined) {
  if (!output) return ""
  const start = output.indexOf("<task_result>")
  if (start < 0) return output
  const end = output.indexOf("</task_result>", start)
  return output.slice(start + "<task_result>".length, end < 0 ? undefined : end).trim()
}
