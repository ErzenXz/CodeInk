import { dict } from "./en"

// Pending translations are listed explicitly so newly added copy still fails the parity test.
const pendingKeys = [
  "ui.brand.name",
  "ui.message.weeklyDelta",
  "ui.message.weeklyDeltaHint",
  "ui.messagePart.group.bash.one",
  "ui.messagePart.group.bash.other",
  "ui.messagePart.group.edit.one",
  "ui.messagePart.group.edit.other",
  "ui.messagePart.group.mcp",
  "ui.messagePart.group.read.one",
  "ui.messagePart.group.read.other",
  "ui.messagePart.group.search.one",
  "ui.messagePart.group.search.other",
  "ui.messagePart.group.tool.one",
  "ui.messagePart.group.tool.other",
  "ui.messagePart.group.webfetch.one",
  "ui.messagePart.group.webfetch.other",
  "ui.messagePart.group.websearch.one",
  "ui.messagePart.group.websearch.other",
  "ui.messagePart.worked",
  "ui.messagePart.workedPlain",
] as const satisfies readonly (keyof typeof dict)[]

export const englishFallback = Object.fromEntries(pendingKeys.map((key) => [key, dict[key]]))
