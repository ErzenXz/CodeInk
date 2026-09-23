import { createEffect, createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { Icon as IconV2 } from "@codeink/ui/v2/icon"
import { MenuV2 } from "@codeink/ui/v2/menu-v2"
import { ProjectAvatar } from "@codeink/ui/v2/project-avatar-v2"
import { SessionProgressIndicatorV2 } from "@codeink/session-ui/v2/session-progress-indicator-v2"
import { useDialog } from "@codeink/ui/context/dialog"
import { useGlobal, type ServerCtx } from "@/context/global"
import { useLanguage } from "@/context/language"
import { getProjectAvatarVariant, useLayout, type LocalProject } from "@/context/layout"
import { ServerConnection, serverName } from "@/context/server"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { tabKey, useTabs, type DraftTab, type SessionTab } from "@/context/tabs"
import { settingsHref } from "@/components/settings-dialog"
import { createDraftPromptSession, type PromptSession } from "@/context/prompt-state"
import {
  displayName,
  errorMessage,
  getProjectAvatarSource,
  projectForSession,
  sortedRootSessions,
} from "@/pages/layout/helpers"
import { pathKey } from "@/utils/path-key"
import { fileManagerApp } from "@/utils/file-manager"
import { sessionHref } from "@/utils/session-route"
import { showToast } from "@/utils/toast"
import type { Session } from "@codeink/sdk/v2"

type Status = "working" | "attention" | "idle"
type SidebarItem = {
  key: string
  server: ServerConnection.Key
  directory: string
  project?: LocalProject
  title: string
  updated: number
  status: Status
  open: boolean
  sessionId?: string
  draft?: DraftTab
  blankDraft?: boolean
}
type SidebarGroup = {
  key: string
  label: string
  items: SidebarItem[]
  project: boolean
  projectInfo?: LocalProject
  server?: ServerConnection.Key
}

const chatPageSize = 6
const projectPageSize = 8

export function SessionSidebar(props: { search: string }) {
  const global = useGlobal()
  const tabs = useTabs()
  const layout = useLayout()
  const language = useLanguage()
  const settings = useSettings()
  const platform = usePlatform()
  const dialog = useDialog()
  const navigate = useNavigate()
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({})
  const [paging, setPaging] = createStore({
    projects: projectPageSize,
    groups: {} as Record<string, number>,
    loading: {} as Record<string, boolean>,
  })
  const requested = new Set<string>()
  const resolving = new Set<string>()

  createEffect(() => {
    settings.general.sidebarGroupBy()
    settings.general.sidebarView()
    props.search
    setPaging({ projects: projectPageSize, groups: {}, loading: {} })
  })

  const sources = createMemo(() =>
    global.servers.list().flatMap((conn) => {
      const server = ServerConnection.key(conn)
      const ctx = global.ensureServerCtx(conn)
      return ctx.projects.list().flatMap((project) =>
        [...new Set([project.worktree, ...(project.sandboxes ?? [])])].map((directory) => ({
          server,
          ctx,
          project,
          directory,
        })),
      )
    }),
  )

  createEffect(() => {
    global.servers.list().forEach((conn) => {
      const server = ServerConnection.key(conn)
      const ctx = global.ensureServerCtx(conn)
      const ids = [
        ...(settings.general.sidebarView() === "activity" ? activeIDs(ctx) : []),
        ...tabs.store.flatMap((tab) => (tab.type === "session" && tab.server === server ? [tab.sessionId] : [])),
      ]
      ids.forEach((id) => {
        const key = `${server}\n${id}`
        if (ctx.sync.session.peek(id) || resolving.has(key)) return
        resolving.add(key)
        void ctx.sync.session
          .resolve(id)
          .catch(() => undefined)
          .finally(() => resolving.delete(key))
      })
    })
  })

  const items = createMemo(() => {
    const result = new Map<string, SidebarItem>()
    const openSessions = new Set(
      tabs.store.flatMap((tab) => (tab.type === "session" ? [`${tab.server}\n${tab.sessionId}`] : [])),
    )
    const projectFor = (ctx: ServerCtx, directory: string) =>
      ctx.projects
        .list()
        .find(
          (project) =>
            pathKey(project.worktree) === pathKey(directory) ||
            project.sandboxes?.some((sandbox) => pathKey(sandbox) === pathKey(directory)),
        )
    const add = (
      server: ServerConnection.Key,
      ctx: ServerCtx,
      id: string,
      session?: Session,
      project?: LocalProject,
    ) => {
      const key = `${server}\n${id}`
      if (result.has(key)) return
      const tab: SessionTab = { type: "session", server, sessionId: id }
      const info = tabs.info[tabKey(tab)]
      const directory = session?.directory ?? info?.directory ?? ""
      result.set(key, {
        key,
        server,
        sessionId: id,
        directory,
        project: project ?? (session ? projectForSession(session, ctx.projects.list()) : projectFor(ctx, directory)),
        title: session?.title ?? info?.title ?? language.t("session.tab.unknown"),
        updated: session?.time.updated ?? session?.time.created ?? 0,
        status: statusFor(ctx, id),
        open: openSessions.has(key),
      })
    }

    sources().forEach((source) => {
      const store = source.ctx.sync.child(source.directory, { bootstrap: false })[0]
      sortedRootSessions(store, 0).forEach((session) =>
        add(source.server, source.ctx, session.id, session, source.project),
      )
    })
    global.servers.list().forEach((conn) => {
      const server = ServerConnection.key(conn)
      const ctx = global.ensureServerCtx(conn)
      activeIDs(ctx).forEach((id) => add(server, ctx, id, ctx.sync.session.peek(id)))
    })
    tabs.store.forEach((tab) => {
      const conn = global.servers.list().find((item) => ServerConnection.key(item) === tab.server)
      if (!conn) return
      const ctx = global.ensureServerCtx(conn)
      if (tab.type === "session") {
        add(tab.server, ctx, tab.sessionId, ctx.sync.session.peek(tab.sessionId))
        return
      }
      const prompt = tabs.state<PromptSession>(tab, "prompt", () => createDraftPromptSession(tab.draftID))
      const title = prompt.ready()
        ? prompt
            .current()
            .flatMap((part) => (part.type === "text" ? [part.content] : []))
            .join("")
            .trim()
            .slice(0, 120)
        : ""
      result.set(tabKey(tab), {
        key: tabKey(tab),
        server: tab.server,
        directory: tab.directory,
        project: projectFor(ctx, tab.directory),
        title: title || language.t("sidebar.sessions.newChat"),
        updated: 0,
        status: "idle",
        open: true,
        draft: tab,
        blankDraft: prompt.ready() && !prompt.dirty() && prompt.context.items().length === 0,
      })
    })
    return [...result.values()].sort((a, b) => b.updated - a.updated)
  })

  const visibleItems = createMemo(() => {
    const query = props.search.trim().toLowerCase()
    const list = items()
    const blank = new Map<string, string>()
    list.forEach((item) => {
      if (!item.blankDraft) return
      blank.set(`${item.server}\n${pathKey(item.directory)}`, item.key)
    })
    const route = layout.route()
    if (route.type === "draft") {
      const active = list.find((item) => item.draft?.draftID === route.draftID)
      if (active?.blankDraft) blank.set(`${active.server}\n${pathKey(active.directory)}`, active.key)
    }
    return list.filter(
      (item) =>
        (settings.general.sidebarView() !== "activity" || (!!item.sessionId && item.status !== "idle")) &&
        (!item.blankDraft || blank.get(`${item.server}\n${pathKey(item.directory)}`) === item.key) &&
        (!query ||
          item.title.toLowerCase().includes(query) ||
          (item.project && displayName(item.project).toLowerCase().includes(query))),
    )
  })

  const groups = createMemo(() => {
    const by = settings.general.sidebarGroupBy()
    const result = new Map<string, SidebarGroup>()
    if (by === "project" && settings.general.sidebarView() === "all" && !props.search.trim()) {
      sources()
        .filter((source) => source.directory === source.project.worktree)
        .forEach((source) => {
          const key = `project:${source.server}:${pathKey(source.project.worktree)}`
          if (!result.has(key))
            result.set(key, {
              key,
              label: displayName(source.project),
              items: [],
              project: true,
              projectInfo: source.project,
              server: source.server,
            })
        })
    }
    visibleItems().forEach((item) => {
      const group = groupFor(item, by, language.t, global.servers.list())
      const current = result.get(group.key)
      if (current) current.items.push(item)
      if (!current) result.set(group.key, { ...group, items: [item] })
    })
    const list = [...result.values()]
    if (by === "project" || by === "none") return list
    if (by === "status") {
      const order = ["attention", "working", "idle", "draft"]
      return list.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
    }
    if (by === "recent") {
      const order = ["today", "yesterday", "older"]
      return list.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
    }
    return list.sort((a, b) => a.label.localeCompare(b.label))
  })

  const open = (item: SidebarItem, event?: MouseEvent) => {
    if (item.draft) {
      tabs.select(item.draft)
      return
    }
    if (!item.sessionId) return
    const tab = tabs.addSessionTab({ server: item.server, sessionId: item.sessionId })
    if (event?.metaKey || event?.ctrlKey || event?.shiftKey) return
    tabs.select(tab)
  }

  const connection = (key: ServerConnection.Key) =>
    global.servers.list().find((item) => ServerConnection.key(item) === key)

  const copy = (value: string) =>
    void navigator.clipboard.writeText(value).catch((cause: unknown) =>
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(cause, language.t("common.requestFailed")),
      }),
    )

  const editProject = (group: SidebarGroup) => {
    const conn = group.server ? connection(group.server) : undefined
    const project = group.projectInfo
    if (!conn || !project) return
    void import("@/components/dialog-edit-project-v2").then(({ DialogEditProjectV2 }) =>
      dialog.show(() => <DialogEditProjectV2 server={conn} project={project} />),
    )
  }

  const openProject = (group: SidebarGroup) => {
    const server = group.server
    const project = group.projectInfo
    const conn = server ? connection(server) : undefined
    if (!server || !project || !conn) return
    global.ensureServerCtx(conn).projects.touch(project.worktree)
    layout.home.setSelection({ server, directory: project.worktree })
    navigate("/")
  }

  const newProjectChat = (group: SidebarGroup) => {
    if (!group.server || !group.projectInfo) return
    void tabs.newDraft({ server: group.server, directory: group.projectInfo.worktree })
  }

  const revealProject = (group: SidebarGroup) => {
    const conn = group.server ? connection(group.server) : undefined
    if (!conn || !group.projectInfo || !platform.openPath || !ServerConnection.local(conn)) return
    void platform.openPath(group.projectInfo.worktree).catch((cause: unknown) =>
      showToast({
        title: language.t("common.requestFailed"),
        description: errorMessage(cause, language.t("common.requestFailed")),
      }),
    )
  }

  const closeProject = (group: SidebarGroup) => {
    const server = group.server
    const project = group.projectInfo
    const conn = server ? connection(server) : undefined
    if (!server || !project || !conn) return
    global.ensureServerCtx(conn).projects.close(project.worktree)
    const selected = layout.home.selection()
    if (selected.server === server && selected.directory === project.worktree) layout.home.setSelection({ server })
  }

  const renameSession = (item: SidebarItem) => {
    const conn = connection(item.server)
    const sessionID = item.sessionId
    if (!conn || !sessionID) return
    const ctx = global.ensureServerCtx(conn)
    void import("@/components/dialog-rename-session-v2").then(({ DialogRenameSessionV2 }) =>
      dialog.show(() => (
        <DialogRenameSessionV2
          title={item.title}
          onSave={(title) => {
            const previous = ctx.sync.session.peek(sessionID)
            if (previous) ctx.sync.session.remember({ ...previous, title })
            return ctx.sdk.api.session.rename({ sessionID, title }).catch((cause: unknown) => {
              if (previous) ctx.sync.session.remember(previous)
              throw cause
            })
          }}
        />
      )),
    )
  }

  const closeSessionTab = (item: SidebarItem) => {
    const index = tabs.store.findIndex(
      (tab) => tab.type === "session" && tab.server === item.server && tab.sessionId === item.sessionId,
    )
    if (index !== -1) tabs.closeTab(index)
  }

  const active = (item: SidebarItem) => {
    const route = layout.route()
    if (item.draft) return route.type === "draft" && route.draftID === item.draft.draftID
    return (
      route.type === "session" && route.sessionId === item.sessionId && (!route.server || route.server === item.server)
    )
  }

  const visibleGroups = createMemo(() =>
    groups().filter((group, index) => index < paging.projects || group.items.some((item) => item.open || active(item))),
  )

  createEffect(() => {
    const visible =
      settings.general.sidebarGroupBy() === "project" &&
      settings.general.sidebarView() === "all" &&
      !props.search.trim()
        ? new Set(visibleGroups().map((group) => group.key))
        : undefined
    sources()
      .filter((source) => !visible || visible.has(`project:${source.server}:${pathKey(source.project.worktree)}`))
      .forEach((source) => {
        const key = `${source.server}\n${pathKey(source.directory)}`
        if (requested.has(key)) return
        requested.add(key)
        void source.ctx.sync.project.loadSessions(source.directory).catch(() => requested.delete(key))
      })
  })

  const loadableSources = (group: SidebarGroup) =>
    sources().filter((source) => {
      const by = settings.general.sidebarGroupBy()
      if (by === "project" && group.key !== `project:${source.server}:${pathKey(source.project.worktree)}`) return false
      if (by === "workspace" && group.key !== `workspace:${source.server}:${pathKey(source.directory)}`) return false
      if (by === "server" && group.key !== `server:${source.server}`) return false
      const store = source.ctx.sync.child(source.directory, { bootstrap: false })[0]
      return store.sessionTotal > store.session.filter((session) => !session.parentID).length
    })

  const showMore = async (group: SidebarGroup) => {
    const next = (paging.groups[group.key] ?? chatPageSize) + chatPageSize
    setPaging("groups", group.key, next)
    if (group.items.length >= next) return
    const pending = loadableSources(group)
    if (!pending.length) return
    setPaging("loading", group.key, true)
    await Promise.all(
      pending.map((source) => {
        const store = source.ctx.sync.child(source.directory, { bootstrap: false })[0]
        return source.ctx.sync.project.loadSessions(source.directory, {
          limit: Math.max(store.limit + chatPageSize, next),
        })
      }),
    ).finally(() => setPaging("loading", group.key, false))
  }

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div class="min-h-0 flex-1 overflow-y-auto no-scrollbar pb-4" data-slot="session-sidebar-list">
        <Show
          when={visibleItems().length > 0 || (settings.general.sidebarView() === "all" && !props.search.trim())}
          fallback={
            <div class="px-3 py-6 text-12-regular text-v2-text-text-weak">
              {props.search.trim()
                ? language.t("home.sessions.search.noResults", { query: props.search.trim() })
                : language.t("sidebar.sessions.activity.empty")}
            </div>
          }
        >
          <For each={visibleGroups()}>
            {(group) => {
              const isOpen = () => expanded[group.key] !== false
              const limit = () => paging.groups[group.key] ?? chatPageSize
              const showing = () => group.items.filter((item, index) => index < limit() || item.open || active(item))
              const more = () => group.items.length > showing().length || loadableSources(group).length > 0
              const canReveal = () => {
                const conn = group.server ? connection(group.server) : undefined
                return platform.platform === "desktop" && !!platform.openPath && !!conn && ServerConnection.local(conn)
              }
              return (
                <section class="mb-3" data-sidebar-group={group.key}>
                  <Show when={settings.general.sidebarGroupBy() !== "none"}>
                    <MenuV2.Context>
                      <MenuV2.Context.Trigger
                        as="button"
                        type="button"
                        data-action="sidebar-group"
                        class="flex h-7 w-full items-center gap-2 rounded px-1.5 text-left text-12-medium text-v2-text-text-muted hover:bg-v2-background-bg-layer-03"
                        aria-expanded={isOpen()}
                        onClick={() => setExpanded(group.key, !isOpen())}
                      >
                        <Show when={group.project}>
                          <ProjectAvatar
                            fallback={group.label}
                            src={getProjectAvatarSource(group.projectInfo?.id, group.projectInfo?.icon)}
                            variant={getProjectAvatarVariant(group.projectInfo?.icon?.color)}
                          />
                        </Show>
                        <span class="min-w-0 flex-1 truncate">{group.label}</span>
                        <IconV2
                          name="chevron-down"
                          size="small"
                          class={isOpen() ? "shrink-0" : "shrink-0 -rotate-90"}
                        />
                      </MenuV2.Context.Trigger>
                      <MenuV2.Context.Portal>
                        <MenuV2.Context.Content>
                          <Show when={group.projectInfo && group.server}>
                            <MenuV2.Item data-action="sidebar-project-open" onSelect={() => openProject(group)}>
                              {language.t("command.project.open")}
                            </MenuV2.Item>
                            <MenuV2.Item data-action="sidebar-project-new-chat" onSelect={() => newProjectChat(group)}>
                              {language.t("sidebar.context.project.newChat")}
                            </MenuV2.Item>
                            <MenuV2.Item data-action="sidebar-project-edit" onSelect={() => editProject(group)}>
                              {language.t("dialog.project.edit.title")}
                            </MenuV2.Item>
                            <MenuV2.Separator />
                            <Show when={canReveal()}>
                              <MenuV2.Item data-action="sidebar-project-reveal" onSelect={() => revealProject(group)}>
                                {language.t(fileManagerApp(platform.os ?? "unknown").actionLabel)}
                              </MenuV2.Item>
                            </Show>
                            <MenuV2.Item
                              data-action="sidebar-project-copy-path"
                              onSelect={() => group.projectInfo && copy(group.projectInfo.worktree)}
                            >
                              {language.t("sidebar.context.project.copyPath")}
                            </MenuV2.Item>
                            <MenuV2.Separator />
                            <MenuV2.Item data-action="sidebar-project-close" onSelect={() => closeProject(group)}>
                              {language.t("sidebar.context.project.close")}
                            </MenuV2.Item>
                            <MenuV2.Separator />
                          </Show>
                          <MenuV2.Item onSelect={() => setExpanded(group.key, !isOpen())}>
                            {language.t(isOpen() ? "sidebar.context.group.collapse" : "sidebar.context.group.expand")}
                          </MenuV2.Item>
                        </MenuV2.Context.Content>
                      </MenuV2.Context.Portal>
                    </MenuV2.Context>
                  </Show>
                  <Show when={isOpen()}>
                    <div class="flex flex-col gap-0.5">
                      <For each={showing()}>
                        {(item) => (
                          <MenuV2.Context>
                            <MenuV2.Context.Trigger
                              as="button"
                              type="button"
                              data-action="sidebar-session"
                              data-session-id={item.sessionId}
                              data-draft-id={item.draft?.draftID}
                              aria-current={active(item) ? "page" : undefined}
                              class="group flex h-7 w-full min-w-0 items-center gap-2 rounded pr-2 text-left text-12-regular text-v2-text-text-base hover:bg-v2-background-bg-layer-03"
                              classList={{
                                "bg-v2-background-bg-layer-03": active(item),
                                "pl-6": settings.general.sidebarGroupBy() === "project",
                                "pl-2": settings.general.sidebarGroupBy() !== "project",
                              }}
                              onClick={(event) => open(item, event)}
                              title={item.title}
                            >
                              <span
                                class="flex size-4 shrink-0 items-center justify-center"
                                data-slot="sidebar-session-state"
                              >
                                <Show when={item.status === "working"}>
                                  <SessionProgressIndicatorV2 class="size-4" />
                                </Show>
                                <Show when={item.status === "attention"}>
                                  <span
                                    class="size-2 rounded-full bg-v2-state-fg-warning"
                                    aria-label={language.t("sidebar.sessions.group.attention")}
                                  />
                                </Show>
                              </span>
                              <span class="min-w-0 flex-1 truncate" data-slot="sidebar-session-title">
                                {item.title}
                              </span>
                            </MenuV2.Context.Trigger>
                            <MenuV2.Context.Portal>
                              <MenuV2.Context.Content>
                                <MenuV2.Item data-action="sidebar-session-open" onSelect={() => open(item)}>
                                  {language.t(
                                    item.draft ? "sidebar.context.session.openDraft" : "sidebar.context.session.open",
                                  )}
                                </MenuV2.Item>
                                <Show when={item.sessionId && !item.open}>
                                  <MenuV2.Item
                                    data-action="sidebar-session-open-background"
                                    onSelect={() =>
                                      item.sessionId &&
                                      tabs.addSessionTab({ server: item.server, sessionId: item.sessionId })
                                    }
                                  >
                                    {language.t("sidebar.context.session.openBackground")}
                                  </MenuV2.Item>
                                </Show>
                                <Show when={item.directory}>
                                  <MenuV2.Item
                                    data-action="sidebar-session-new-chat"
                                    onSelect={() =>
                                      void tabs.newDraft({
                                        server: item.server,
                                        directory: item.project?.worktree ?? item.directory,
                                      })
                                    }
                                  >
                                    {language.t("sidebar.context.session.newChat")}
                                  </MenuV2.Item>
                                </Show>
                                <Show when={item.sessionId}>
                                  <MenuV2.Separator />
                                  <MenuV2.Item
                                    data-action="sidebar-session-rename"
                                    onSelect={() => renameSession(item)}
                                  >
                                    {language.t("common.rename")}
                                  </MenuV2.Item>
                                  <MenuV2.Item
                                    data-action="sidebar-session-copy-link"
                                    onSelect={() =>
                                      item.sessionId &&
                                      copy(
                                        new URL(sessionHref(item.server, item.sessionId), window.location.origin).href,
                                      )
                                    }
                                  >
                                    {language.t("sidebar.context.session.copyLink")}
                                  </MenuV2.Item>
                                  <MenuV2.Item
                                    data-action="sidebar-session-copy-id"
                                    onSelect={() => item.sessionId && copy(item.sessionId)}
                                  >
                                    {language.t("sidebar.context.session.copyID")}
                                  </MenuV2.Item>
                                </Show>
                                <Show when={item.directory}>
                                  <MenuV2.Item
                                    data-action="sidebar-session-copy-path"
                                    onSelect={() => copy(item.directory)}
                                  >
                                    {language.t("sidebar.context.project.copyPath")}
                                  </MenuV2.Item>
                                </Show>
                                <Show when={item.sessionId && item.open}>
                                  <MenuV2.Separator />
                                  <MenuV2.Item
                                    data-action="sidebar-session-close-tab"
                                    onSelect={() => closeSessionTab(item)}
                                  >
                                    {language.t("common.closeTab")}
                                  </MenuV2.Item>
                                </Show>
                              </MenuV2.Context.Content>
                            </MenuV2.Context.Portal>
                          </MenuV2.Context>
                        )}
                      </For>
                      <Show when={more()}>
                        <button
                          type="button"
                          data-action="sidebar-group-more"
                          class="h-7 px-3 text-left text-12-regular text-v2-text-text-weak hover:text-v2-text-text-base"
                          disabled={paging.loading[group.key]}
                          aria-busy={paging.loading[group.key] || undefined}
                          onClick={() => void showMore(group)}
                        >
                          {language.t("sidebar.sessions.showMore")}
                        </button>
                      </Show>
                      <Show when={!more() && limit() > chatPageSize && group.items.length > chatPageSize}>
                        <button
                          type="button"
                          data-action="sidebar-group-less"
                          class="h-7 px-3 text-left text-12-regular text-v2-text-text-weak hover:text-v2-text-text-base"
                          onClick={() => setPaging("groups", group.key, chatPageSize)}
                        >
                          {language.t("sidebar.sessions.showLess")}
                        </button>
                      </Show>
                    </div>
                  </Show>
                </section>
              )
            }}
          </For>
          <Show when={visibleGroups().length < groups().length}>
            <button
              type="button"
              data-action="sidebar-projects-more"
              class="h-7 px-3 text-left text-12-regular text-v2-text-text-weak hover:text-v2-text-text-base"
              onClick={() => setPaging("projects", (count) => count + projectPageSize)}
            >
              {language.t(
                settings.general.sidebarGroupBy() === "project"
                  ? "sidebar.projects.showMore"
                  : "sidebar.groups.showMore",
              )}
            </button>
          </Show>
          <Show
            when={
              visibleGroups().length === groups().length &&
              paging.projects > projectPageSize &&
              groups().length > projectPageSize
            }
          >
            <button
              type="button"
              data-action="sidebar-projects-less"
              class="h-7 px-3 text-left text-12-regular text-v2-text-text-weak hover:text-v2-text-text-base"
              onClick={() => setPaging("projects", projectPageSize)}
            >
              {language.t(
                settings.general.sidebarGroupBy() === "project"
                  ? "sidebar.projects.showLess"
                  : "sidebar.groups.showLess",
              )}
            </button>
          </Show>
        </Show>
      </div>
      <button
        type="button"
        data-action="sidebar-settings"
        class="flex h-8 shrink-0 items-center gap-1.5 border-t border-v2-border-border-muted px-1.5 text-left text-12-medium text-v2-text-text-muted hover:text-v2-text-text-base"
        classList={{ "text-v2-text-text-base": layout.route().type === "settings" }}
        onClick={() => navigate(settingsHref(layout.route()))}
      >
        <IconV2 name="settings-gear" size="small" />
        {language.t("sidebar.settings")}
      </button>
    </div>
  )
}

function activeIDs(ctx: ServerCtx) {
  const data = ctx.sync.session.data
  return [
    ...new Set([
      ...Object.entries(data.session_status)
        .filter(([, status]) => status.type !== "idle")
        .map(([id]) => id),
      ...Object.entries(data.permission)
        .filter(([, items]) => items.length > 0)
        .map(([id]) => id),
      ...Object.entries(data.question)
        .filter(([, items]) => items.length > 0)
        .map(([id]) => id),
    ]),
  ]
}

function statusFor(ctx: ServerCtx, id: string): Status {
  const data = ctx.sync.session.data
  if ((data.permission[id]?.length ?? 0) > 0 || (data.question[id]?.length ?? 0) > 0) return "attention"
  if (data.session_working(id)) return "working"
  return "idle"
}

function groupFor(
  item: SidebarItem,
  by: ReturnType<ReturnType<typeof useSettings>["general"]["sidebarGroupBy"]>,
  t: ReturnType<typeof useLanguage>["t"],
  servers: ServerConnection.Any[],
): Omit<SidebarGroup, "items"> {
  if (by === "project") {
    const key = item.project
      ? `project:${item.server}:${pathKey(item.project.worktree)}`
      : `project:${item.server}:unknown`
    return {
      key,
      label: item.project ? displayName(item.project) : t("sidebar.sessions.group.unknownProject"),
      project: true,
      projectInfo: item.project,
    }
  }
  if (by === "workspace")
    return {
      key: `workspace:${item.server}:${pathKey(item.directory)}`,
      label: item.directory ? displayName({ worktree: item.directory }) : t("sidebar.sessions.group.unknownWorkspace"),
      project: false,
    }
  if (by === "status")
    return item.draft
      ? { key: "draft", label: t("sidebar.sessions.group.draft"), project: false }
      : { key: item.status, label: t(`sidebar.sessions.group.${item.status}`), project: false }
  if (by === "server") {
    const conn = servers.find((server) => ServerConnection.key(server) === item.server)
    return { key: `server:${item.server}`, label: serverName(conn) || item.server, project: false }
  }
  if (by === "recent") {
    const today = new Date().setHours(0, 0, 0, 0)
    const key = item.updated >= today ? "today" : item.updated >= today - 86_400_000 ? "yesterday" : "older"
    return { key, label: t(`home.sessions.group.${key}`), project: false }
  }
  if (by === "type")
    return item.draft
      ? { key: "draft", label: t("sidebar.sessions.group.draft"), project: false }
      : { key: "session", label: t("sidebar.sessions.group.session"), project: false }
  return { key: "none", label: "", project: false }
}
