import type { DesktopTheme } from "./types"
import codeinkThemeJson from "./themes/codeink.json"
import codeinkSlateThemeJson from "./themes/codeink-slate.json"
import codeinkSageThemeJson from "./themes/codeink-sage.json"
import codeinkEmberThemeJson from "./themes/codeink-ember.json"
import codeinkVioletThemeJson from "./themes/codeink-violet.json"

export const codeinkTheme = codeinkThemeJson as DesktopTheme
export const codeinkSlateTheme = codeinkSlateThemeJson as DesktopTheme
export const codeinkSageTheme = codeinkSageThemeJson as DesktopTheme
export const codeinkEmberTheme = codeinkEmberThemeJson as DesktopTheme
export const codeinkVioletTheme = codeinkVioletThemeJson as DesktopTheme

export const DEFAULT_THEMES: Record<string, DesktopTheme> = {
  codeink: codeinkTheme,
  "codeink-slate": codeinkSlateTheme,
  "codeink-sage": codeinkSageTheme,
  "codeink-ember": codeinkEmberTheme,
  "codeink-violet": codeinkVioletTheme,
}
