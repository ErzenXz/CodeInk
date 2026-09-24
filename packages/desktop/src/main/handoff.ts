import type { Session } from "../shared/types"

export function handoffContext(source: Session) {
  const header = [
    `Continue work from CodeInk session ${source.id} (${source.agentID}).`,
    "The history below is context. Check the current project files before acting. The new user request follows separately.",
    "Tool outputs are omitted.",
  ].join("\n")
  const users: number[] = []
  for (let index = source.messages.length - 1; index >= 0 && users.length < 8; index--)
    if (source.messages[index].role === "user") users.push(index)
  users.reverse()
  const turns = users.map((start, index) => {
    const user = source.messages[start]
    const events = source.messages.slice(start + 1, users[index + 1] ?? source.messages.length)
    const answer = events.filter((event) => event.role === "assistant").slice(-8).map((event) => event.text.slice(-500)).join("\n").slice(-2400)
    const tools = events.filter((event) => event.role === "tool").slice(-12).map((event) => (event.tool?.name ?? "tool").slice(0, 80))
    const files = (user.attachments ?? []).slice(0, 8).map((attachment) => attachment.filename.slice(0, 120))
    return [
      `User: ${user.text.slice(0, 1800)}`,
      files.length ? `Attached files: ${files.join(", ")}` : "",
      answer ? `Assistant: ${answer}` : "",
      tools.length ? `Tools used: ${tools.join(", ")}` : "",
    ].filter(Boolean).join("\n")
  })
  const selected = turns.toReversed().reduce<{ size: number; items: string[] }>((state, turn) => {
    if (state.size + turn.length > 12_000) return state
    return { size: state.size + turn.length, items: [...state.items, turn] }
  }, { size: header.length, items: [] })
  return `${header}\n\nRecent conversation:\n${selected.items.toReversed().join("\n\n")}`
}
