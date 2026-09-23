import { useNavigate } from "@solidjs/router"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { type LayoutRoute, useLayout } from "@/context/layout"

export function settingsHref(route: LayoutRoute, defaultValue?: string) {
  const search = new URLSearchParams()
  if (defaultValue) search.set("tab", defaultValue)
  if (route.type === "session") search.set("session", route.sessionId)
  if (route.type === "draft") search.set("draft", route.draftID)
  return `/settings${search.size ? `?${search}` : ""}`
}

export function useSettingsPage(defaultValue?: string) {
  const navigate = useNavigate()
  const layout = useLayout()

  return () => {
    navigate(settingsHref(layout.route(), defaultValue))
  }
}

export function useSettingsCommand() {
  const command = useCommand()
  const language = useLanguage()
  const show = useSettingsPage()

  command.register("settings", () => [
    {
      id: "settings.open",
      title: language.t("command.settings.open"),
      category: language.t("command.category.settings"),
      keybind: "mod+comma",
      onSelect: show,
    },
  ])

  return show
}
