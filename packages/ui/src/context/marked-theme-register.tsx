import { registerCustomTheme } from "@pierre/diffs"
import { CodeInkTheme } from "./marked-theme"

let registered = false

export function registerCodeInkTheme() {
  if (registered) return
  registered = true
  registerCustomTheme("CodeInk", () => Promise.resolve(CodeInkTheme))
}
