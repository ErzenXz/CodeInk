import { createEffect, createMemo, createSignal, For, lazy, Show, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { createMediaQuery } from "@solid-primitives/media"
import { useNavigate } from "@solidjs/router"
import { Icon as IconV2 } from "@codeink/ui/v2/icon"
import { MenuV2 } from "@codeink/ui/v2/menu-v2"
import { DebugBar } from "@/components/debug-bar"
import { AgentInfoPopup } from "@/components/help-button"
import { Titlebar, type TitlebarUpdate } from "@/components/titlebar"
import { SessionSidebar } from "@/components/session-sidebar"
import { SessionSidebarFilters, type SessionSidebarControls } from "@/components/session-sidebar-filters"
import { useDirectoryPicker } from "@/components/directory-picker"
import { useGlobal } from "@/context/global"
import { ServerConnection, useServer } from "@/context/server"
import { homeProjectDirectories } from "@/pages/layout/helpers"
import { openProjects } from "@/utils/open-projects"
import { useCommand } from "@/context/command"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useLanguage } from "@/context/language"
import { useTabs } from "@/context/tabs"
import { setV2Toast, ToastRegion } from "@/utils/toast"

const SessionPane = lazy(() => import("@/pages/session/pane").then((module) => ({ default: module.SessionPane })))
const maxPanes = 3

const hubNav = [
  { page: "library", icon: "library", label: "sidebar.nav.library" },
  { page: "skills", icon: "grid-plus", label: "sidebar.nav.skills" },
] as const
const sidebarViewOptions = ["all", "activity", "attention"] as const
const sidebarViewLabels = {
  all: "sidebar.sessions.view.all",
  activity: "sidebar.sessions.view.activity",
  attention: "sidebar.sessions.status.attention",
} as const

export default function NewLayout(props: ParentProps) {
  const platform = usePlatform()
  const settings = useSettings()
  const command = useCommand()
  const layout = useLayout()
  const navigate = useNavigate()
  const language = useLanguage()
  const global = useGlobal()
  const server = useServer()
  const pickDirectory = useDirectoryPicker()
  const wide = createMediaQuery("(min-width: 1024px)")
  // Narrow windows always fall back to top tabs.
  const mode = createMemo(() => (wide() ? settings.general.sessionTabPosition() : "top"))
  const sidebar = createMemo(() => mode() !== "top")
  command.register("new-layout-sidebar", () => [
    {
      id: "sidebar.toggle",
      title: language.t("command.sidebar.toggle"),
      category: language.t("command.category.view"),
      keybind: "mod+b",
      onSelect: () => layout.sidebarV2.toggle(),
    },
  ])
  const [sidebarControls, setSidebarControls] = createSignal<SessionSidebarControls>()
  const addProject = () => {
    const conn = server.current ?? global.servers.list()[0]
    if (!conn) return
    pickDirectory({
      server: conn,
      title: language.t("command.project.open"),
      multiple: true,
      onSelect: (result) => openProjects(global.ensureServerCtx(conn), homeProjectDirectories(result)),
    })
  }
  const [state, setState] = createStore({
    debugTools: true,
    sidebarSearchOpen: false,
    sidebarQuery: "",
    sidebarViewMenuOpen: false,
  })
  const [panes, setPanes] = createStore<{ server: ServerConnection.Key; sessionId: string; title: string }[]>([])
  const canOpenPane = (session: { server: ServerConnection.Key; sessionId: string }) => {
    const route = layout.route()
    return (
      panes.length < maxPanes - 1 &&
      !panes.some((pane) => pane.server === session.server && pane.sessionId === session.sessionId) &&
      !(route.type === "session" && route.server === session.server && route.sessionId === session.sessionId)
    )
  }

  createEffect(() => setV2Toast(true))

  // The overview belongs to top tabs. A fresh install should still open the composer;
  // its project picker will ask for a directory before the first prompt runs.
  const tabs = useTabs()
  const hasProjects = createMemo(() =>
    global.servers.list().some((conn) => global.ensureServerCtx(conn).projects.list().length > 0),
  )
  createEffect(() => {
    if (!tabs.ready() || layout.route().type !== "home") return
    const connections = global.servers.list()
    if (sidebar() && hasProjects()) {
      command.trigger("tab.new")
      return
    }
    if (hasProjects()) return
    const conn =
      (server.current && global.ensureServerCtx(server.current).sync.data.path.home ? server.current : undefined) ??
      connections.find((item) => global.ensureServerCtx(item).sync.data.path.home)
    if (!conn) return
    void tabs.newDraft({ server: ServerConnection.key(conn), directory: global.ensureServerCtx(conn).sync.data.path.home })
  })

  const update: TitlebarUpdate = {
    version: () => {
      const state = platform.updater?.state()
      if (state?.status === "available" || state?.status === "ready") return state.version
    },
    actionLabel: () =>
      language.t(
        platform.updater?.state().status === "ready"
          ? "toast.update.action.installRestart"
          : "toast.update.action.viewDownload",
      ),
    activate: () =>
      void (platform.updater?.state().status === "ready"
        ? platform.updater.install()
        : platform.updater?.openDownload()),
  }

  return (
    <div
      data-shell={sidebar() ? "sidebar" : "tabs"}
      data-layout-mode={mode()}
      class="group/shell relative [background:var(--v2-glass-ambient)] flex-1 min-h-0 min-w-0 flex flex-col select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
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
        <Show when={sidebar() && layout.sidebarV2.opened()}>
          <aside
            class="flex w-72 shrink-0 min-h-0 flex-col bg-transparent px-2.5 pb-2.5 pt-1"
            aria-label={language.t("home.sessions.search.sessions")}
          >
            <div class="flex h-11 shrink-0 items-center px-2.5 text-[17px] font-semibold tracking-[-0.2px] text-v2-text-text-base">
              {language.t("sidebar.brand")}
            </div>
            <button
              type="button"
              data-action="sidebar-new-session"
              class="flex h-8 w-full shrink-0 items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] leading-5 font-[440] text-v2-text-text-base hover:bg-[var(--v2-glass-surface-hover)] transition-colors duration-150"
              classList={{ "!bg-[var(--v2-glass-surface-pressed)]": layout.route().type === "draft" }}
              onClick={() => command.trigger("tab.new")}
            >
              <IconV2 name="edit" size="normal" />
              <span>{language.t("sidebar.sessions.newChat")}</span>
            </button>
            <nav class="mb-4 mt-0.5 flex flex-col gap-0.5" aria-label={language.t("sidebar.nav.projectsAndSessions")}>
              <For each={hubNav}>
                {(item) => (
                  <button
                    type="button"
                    data-action={`sidebar-hub-${item.page}`}
                    class="flex h-8 w-full shrink-0 items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] leading-5 font-[440] text-v2-text-text-base hover:bg-[var(--v2-glass-surface-hover)] transition-colors duration-150"
                    classList={{
                      "!bg-[var(--v2-glass-surface-pressed)]": (() => {
                        const route = layout.route()
                        return route.type === "hub" && route.page === item.page
                      })(),
                    }}
                    aria-current={(() => {
                      const route = layout.route()
                      return route.type === "hub" && route.page === item.page ? "page" : undefined
                    })()}
                    onClick={() => navigate(`/${item.page}`)}
                  >
                    <IconV2 name={item.icon} size="normal" />
                    <span>{language.t(item.label)}</span>
                  </button>
                )}
              </For>
            </nav>
            <div class="mb-1 flex h-8 shrink-0 items-center gap-0.5" data-slot="session-sidebar-toolbar">
              <Show
                when={state.sidebarSearchOpen}
                fallback={
                  <Show
                    when={mode() === "sidebar"}
                    fallback={
                      <span class="flex h-8 min-w-0 flex-1 items-center px-2.5 text-12-medium text-v2-text-text-faint">
                        {language.t("sidebar.projects.label")}
                      </span>
                    }
                  >
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
                        class="flex h-8 min-w-0 flex-1 items-center gap-1 rounded-md px-2.5 text-left text-12-medium text-v2-text-text-faint hover:bg-[var(--v2-glass-surface-hover)] transition-colors duration-150"
                      >
                        <span class="truncate">
                          {settings.general.sidebarView() === "all"
                            ? language.t("home.sessions.search.sessions")
                            : language.t(sidebarViewLabels[settings.general.sidebarView()])}
                        </span>
                        <IconV2 name="chevron-down" size="small" class="shrink-0" />
                      </MenuV2.Trigger>
                      <MenuV2.Portal>
                        <MenuV2.Content>
                          <MenuV2.RadioGroup
                            value={settings.general.sidebarView()}
                            onChange={(value) => {
                              const next = sidebarViewOptions.find((option) => option === value)
                              if (next) settings.general.setSidebarView(next)
                            }}
                          >
                            <For each={sidebarViewOptions}>
                              {(option) => (
                                <MenuV2.RadioItem
                                  value={option}
                                  onSelect={() => setState("sidebarViewMenuOpen", false)}
                                >
                                  {language.t(sidebarViewLabels[option])}
                                </MenuV2.RadioItem>
                              )}
                            </For>
                          </MenuV2.RadioGroup>
                        </MenuV2.Content>
                      </MenuV2.Portal>
                    </MenuV2>
                  </Show>
                }
              >
                <input
                  ref={(element) => queueMicrotask(() => element.focus())}
                  type="search"
                  data-action="sidebar-search-input"
                  class="h-8 min-w-0 flex-1 rounded-md bg-[var(--v2-glass-surface-hover)] px-2.5 text-12-regular text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
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
                data-action="sidebar-add-project"
                class="flex size-7 shrink-0 items-center justify-center rounded-md text-v2-icon-icon-muted hover:bg-[var(--v2-glass-surface-hover)] hover:text-v2-icon-icon-base"
                aria-label={language.t("sidebar.projects.add")}
                title={language.t("sidebar.projects.add")}
                onClick={addProject}
              >
                <IconV2 name="plus" size="small" />
              </button>
              <button
                type="button"
                data-action="sidebar-search-toggle"
                class="flex size-7 shrink-0 items-center justify-center rounded-md text-v2-icon-icon-muted hover:bg-[var(--v2-glass-surface-hover)] hover:text-v2-icon-icon-base"
                aria-label={language.t("home.sessions.search.placeholder")}
                aria-pressed={state.sidebarSearchOpen}
                onClick={() => setState({ sidebarSearchOpen: !state.sidebarSearchOpen, sidebarQuery: "" })}
              >
                <IconV2 name="magnifying-glass" size="small" />
              </button>
              <Show when={mode() === "sidebar"}>
                <SessionSidebarFilters controls={sidebarControls} />
              </Show>
            </div>
            <SessionSidebar
              search={state.sidebarQuery}
              mode={mode() === "projects" ? "projects" : "sessions"}
              onControls={setSidebarControls}
              canOpenPane={canOpenPane}
              onOpenPane={(session) => setPanes(panes.length, session)}
            />
          </aside>
        </Show>
        <div class="flex flex-1 min-h-0 min-w-0 overflow-hidden">
          <main class="flex-1 min-h-0 min-w-0 overflow-x-hidden flex flex-col items-start contain-strict">
            <Suspense>
              <Show
                when={layout.route().type !== "home" || (!sidebar() && hasProjects())}
                fallback={
                  <div class="flex size-full items-center justify-center text-12-regular text-v2-text-text-faint">
                    {language.t("common.loading")}
                  </div>
                }
              >
                {props.children}
              </Show>
            </Suspense>
          </main>
          <For each={panes}>
            {(pane) => (
              <section
                data-component="session-pane"
                data-session-id={pane.sessionId}
                class="flex flex-1 min-h-0 min-w-0 flex-col border-l border-v2-border-border-muted"
              >
                <div class="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-v2-border-border-muted px-3 text-12-medium text-v2-text-text-muted">
                  <span class="truncate">{pane.title}</span>
                  <button
                    type="button"
                    data-action="session-pane-close"
                    class="rounded px-2 py-1 hover:bg-[var(--v2-glass-surface-hover)]"
                    aria-label={language.t("common.close")}
                    onClick={() =>
                      setPanes((current) =>
                        current.filter((item) => item.server !== pane.server || item.sessionId !== pane.sessionId),
                      )
                    }
                  >
                    <IconV2 name="xmark-small" size="small" />
                  </button>
                </div>
                <Suspense>
                  <SessionPane server={pane.server} sessionId={pane.sessionId} />
                </Suspense>
              </section>
            )}
          </For>
        </div>
      </div>
      {import.meta.env.DEV && state.debugTools && <DebugBar inline />}
      <AgentInfoPopup />
      <ToastRegion v2 />
    </div>
  )
}
