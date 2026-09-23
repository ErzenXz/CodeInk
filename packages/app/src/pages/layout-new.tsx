import { createEffect, createMemo, For, Show, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { Icon as IconV2 } from "@codeink/ui/v2/icon"
import { MenuV2 } from "@codeink/ui/v2/menu-v2"
import { DebugBar } from "@/components/debug-bar"
import { TabsInfoPopup } from "@/components/help-button"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { SessionSidebar } from "@/components/session-sidebar"
import { useCommand } from "@/context/command"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useLanguage } from "@/context/language"
import { setV2Toast, ToastRegion } from "@/utils/toast"

const sidebarGroupOptions = ["project", "workspace", "status", "server", "recent", "type", "none"] as const
const sidebarViewOptions = ["all", "activity"] as const
const sidebarViewLabels = {
  all: "sidebar.sessions.view.all",
  activity: "sidebar.sessions.view.activity",
} as const
const sidebarStatusLabels = {
  all: "sidebar.sessions.view.all",
  activity: "sidebar.sessions.status.active",
} as const
const sidebarGroupLabels = {
  project: "sidebar.sessions.group.project",
  workspace: "sidebar.sessions.group.workspace",
  status: "sidebar.sessions.group.status",
  server: "sidebar.sessions.group.server",
  recent: "sidebar.sessions.group.recent",
  type: "sidebar.sessions.group.type",
  none: "sidebar.sessions.group.none",
} as const

export default function NewLayout(props: ParentProps) {
  const platform = usePlatform()
  const settings = useSettings()
  const command = useCommand()
  const language = useLanguage()
  const wide = createMediaQuery("(min-width: 1024px)")
  const sidebar = createMemo(() => wide() && settings.general.sessionTabPosition() === "sidebar")
  const [state, setState] = createStore({
    debugTools: true,
    sidebarSearchOpen: false,
    sidebarQuery: "",
    sidebarViewMenuOpen: false,
    sidebarFilterMenuOpen: false,
  })

  createEffect(() => setV2Toast(true))

  const update: TitlebarUpdate = {
    version: () => {
      const state = platform.updater?.state()
      if (state?.status !== "ready") return
      return state.version
    },
    installing: () => platform.updater?.state().status === "installing",
    install: () => void platform.updater?.install(),
  }

  return (
    <div
      class="relative bg-v2-background-bg-deep flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
      style={{
        "padding-top": "env(safe-area-inset-top, 0px)",
        "padding-bottom": "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <Titlebar
        update={update}
        debugTools={
          import.meta.env.DEV
            ? { visible: state.debugTools, toggle: () => setState("debugTools", (value) => !value) }
            : undefined
        }
      />
      <div class="flex flex-1 min-h-0 min-w-0">
        <Show when={sidebar()}>
          <aside
            class="flex w-60 shrink-0 min-h-0 flex-col bg-v2-background-bg-deep p-3"
            aria-label={language.t("home.sessions.search.sessions")}
          >
            <div class="flex h-9 shrink-0 items-center px-1 text-16-medium text-v2-text-text-base">
              {language.t("sidebar.brand")}
            </div>
            <button
              type="button"
              data-action="sidebar-new-session"
              class="mb-3 flex h-8 w-full shrink-0 items-center gap-2 rounded px-1.5 text-left text-13-medium text-v2-text-text-base hover:bg-v2-background-bg-layer-03"
              onClick={() => command.trigger("tab.new")}
            >
              <IconV2 name="edit" size="small" />
              <span>{language.t("sidebar.sessions.newChat")}</span>
            </button>
            <div class="mb-2 flex h-8 shrink-0 items-center gap-1" data-slot="session-sidebar-toolbar">
              <Show
                when={state.sidebarSearchOpen}
                fallback={
                  <MenuV2
                    placement="bottom-start"
                    gutter={4}
                    open={state.sidebarViewMenuOpen}
                    onOpenChange={(open) => setState("sidebarViewMenuOpen", open)}
                  >
                    <MenuV2.Trigger
                      as="button"
                      type="button"
                      data-action="sidebar-view"
                      class="flex h-7 min-w-0 flex-1 items-center gap-1 rounded px-1 text-left text-12-medium text-v2-text-text-muted hover:bg-v2-background-bg-layer-02"
                    >
                      <span class="truncate">
                        {settings.general.sidebarView() === "all"
                          ? language.t("home.sessions.search.sessions")
                          : language.t(sidebarViewLabels.activity)}
                      </span>
                      <IconV2 name="chevron-down" size="small" class="shrink-0" />
                    </MenuV2.Trigger>
                    <MenuV2.Portal>
                      <MenuV2.Content>
                        <MenuV2.RadioGroup
                          value={settings.general.sidebarView()}
                          onChange={(value) =>
                            settings.general.setSidebarView(value as (typeof sidebarViewOptions)[number])
                          }
                        >
                          <For each={sidebarViewOptions}>
                            {(option) => (
                              <MenuV2.RadioItem value={option} onSelect={() => setState("sidebarViewMenuOpen", false)}>
                                {language.t(sidebarViewLabels[option])}
                              </MenuV2.RadioItem>
                            )}
                          </For>
                        </MenuV2.RadioGroup>
                      </MenuV2.Content>
                    </MenuV2.Portal>
                  </MenuV2>
                }
              >
                <input
                  ref={(element) => queueMicrotask(() => element.focus())}
                  type="search"
                  data-action="sidebar-search-input"
                  class="h-7 min-w-0 flex-1 rounded bg-v2-background-bg-layer-02 px-2 text-12-regular text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
                  value={state.sidebarQuery}
                  placeholder={language.t("home.sessions.search.placeholder")}
                  aria-label={language.t("home.sessions.search.placeholder")}
                  onInput={(event) => setState("sidebarQuery", event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return
                    setState({ sidebarSearchOpen: false, sidebarQuery: "" })
                  }}
                />
              </Show>
              <button
                type="button"
                data-action="sidebar-search-toggle"
                class="flex size-7 shrink-0 items-center justify-center rounded text-v2-icon-icon-muted hover:bg-v2-background-bg-layer-02 hover:text-v2-icon-icon-base"
                aria-label={language.t("home.sessions.search.placeholder")}
                aria-pressed={state.sidebarSearchOpen}
                onClick={() => setState({ sidebarSearchOpen: !state.sidebarSearchOpen, sidebarQuery: "" })}
              >
                <IconV2 name="magnifying-glass" size="small" />
              </button>
              <MenuV2
                placement="bottom-end"
                gutter={4}
                open={state.sidebarFilterMenuOpen}
                onOpenChange={(open) => setState("sidebarFilterMenuOpen", open)}
              >
                <MenuV2.Trigger
                  as="button"
                  type="button"
                  data-action="sidebar-filters"
                  class="flex size-7 shrink-0 items-center justify-center rounded text-v2-icon-icon-muted hover:bg-v2-background-bg-layer-02 hover:text-v2-icon-icon-base"
                  aria-label={language.t("sidebar.sessions.filters")}
                >
                  <IconV2 name="outline-sliders" size="small" />
                </MenuV2.Trigger>
                <MenuV2.Portal>
                  <MenuV2.Content class="min-w-[224px]">
                    <MenuV2.Sub gutter={0} overlap overflowPadding={8}>
                      <MenuV2.SubTrigger data-action="sidebar-filter-status">
                        <span class="flex-1">{language.t("sidebar.sessions.group.status")}</span>
                        <span class="text-v2-text-text-muted">
                          {language.t(sidebarStatusLabels[settings.general.sidebarView()])}
                        </span>
                      </MenuV2.SubTrigger>
                      <MenuV2.Portal>
                        <MenuV2.SubContent>
                          <MenuV2.RadioGroup
                            value={settings.general.sidebarView()}
                            onChange={(value) =>
                              settings.general.setSidebarView(value as (typeof sidebarViewOptions)[number])
                            }
                          >
                            <For each={sidebarViewOptions}>
                              {(option) => (
                                <MenuV2.RadioItem
                                  value={option}
                                  onSelect={() => setState("sidebarFilterMenuOpen", false)}
                                >
                                  {language.t(sidebarStatusLabels[option])}
                                </MenuV2.RadioItem>
                              )}
                            </For>
                          </MenuV2.RadioGroup>
                        </MenuV2.SubContent>
                      </MenuV2.Portal>
                    </MenuV2.Sub>
                    <MenuV2.Separator />
                    <MenuV2.Sub gutter={0} overlap overflowPadding={8}>
                      <MenuV2.SubTrigger data-action="sidebar-filter-group-by">
                        <span class="flex-1">{language.t("sidebar.sessions.group.label")}</span>
                        <span class="text-v2-text-text-muted">
                          {language.t(sidebarGroupLabels[settings.general.sidebarGroupBy()])}
                        </span>
                      </MenuV2.SubTrigger>
                      <MenuV2.Portal>
                        <MenuV2.SubContent>
                          <MenuV2.RadioGroup
                            value={settings.general.sidebarGroupBy()}
                            onChange={(value) =>
                              settings.general.setSidebarGroupBy(value as (typeof sidebarGroupOptions)[number])
                            }
                          >
                            <For each={sidebarGroupOptions}>
                              {(option) => (
                                <MenuV2.RadioItem
                                  value={option}
                                  onSelect={() => setState("sidebarFilterMenuOpen", false)}
                                >
                                  {language.t(sidebarGroupLabels[option])}
                                </MenuV2.RadioItem>
                              )}
                            </For>
                          </MenuV2.RadioGroup>
                        </MenuV2.SubContent>
                      </MenuV2.Portal>
                    </MenuV2.Sub>
                  </MenuV2.Content>
                </MenuV2.Portal>
              </MenuV2>
            </div>
            <SessionSidebar search={state.sidebarQuery} />
          </aside>
        </Show>
        <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
          <Suspense>{props.children}</Suspense>
        </main>
      </div>
      {import.meta.env.DEV && state.debugTools && <DebugBar inline />}
      <TabsInfoPopup />
      <ToastRegion v2 />
    </div>
  )
}
