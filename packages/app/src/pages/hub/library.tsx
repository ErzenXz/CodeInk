import { createMemo, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@codeink/ui/v2/icon"
import { MenuV2 } from "@codeink/ui/v2/menu-v2"
import { TextInputV2 } from "@codeink/ui/v2/text-input-v2"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { ServerConnection } from "@/context/server"
import { useTabs } from "@/context/tabs"
import { displayName, sortedRootSessions } from "@/pages/layout/helpers"
import { getRelativeTime } from "@/utils/time"
import { HubCard, HubEmpty, HubPage } from "./hub-page"

const day = 24 * 60 * 60 * 1000
const buckets = ["today", "yesterday", "week", "month", "older"] as const

export default function LibraryPage() {
  const global = useGlobal()
  const tabs = useTabs()
  const language = useLanguage()
  const [state, setState] = createStore({ query: "", project: "all" })

  const chats = createMemo(() =>
    global.servers.list().flatMap((conn) => {
      const server = ServerConnection.key(conn)
      const ctx = global.ensureServerCtx(conn)
      return ctx.projects.list().flatMap((info) =>
        [...new Set([info.worktree, ...(info.sandboxes ?? [])])].flatMap((directory) =>
          sortedRootSessions(ctx.sync.child(directory, { bootstrap: false })[0], 0).map((session) => ({
            key: `${server}\n${session.id}`,
            server,
            id: session.id,
            title: session.title || language.t("session.tab.unknown"),
            project: `${server}\n${info.worktree}`,
            projectName: displayName(info),
            updated: session.time.updated ?? session.time.created,
          })),
        ),
      )
    }),
  )

  const projects = createMemo(() =>
    [...new Map(chats().map((chat) => [chat.project, chat.projectName])).entries()].sort((a, b) =>
      a[1].localeCompare(b[1]),
    ),
  )

  const groups = createMemo(() => {
    const needle = state.query.trim().toLowerCase()
    const start = new Date().setHours(0, 0, 0, 0)
    const bucket = (updated: number) =>
      updated >= start
        ? "today"
        : updated >= start - day
          ? "yesterday"
          : updated >= start - 7 * day
            ? "week"
            : updated >= start - 30 * day
              ? "month"
              : "older"
    const visible = chats()
      .filter((chat) => state.project === "all" || chat.project === state.project)
      .filter(
        (chat) =>
          !needle || chat.title.toLowerCase().includes(needle) || chat.projectName.toLowerCase().includes(needle),
      )
      .sort((a, b) => b.updated - a.updated)
    return buckets
      .map((key) => ({ key, items: visible.filter((chat) => bucket(chat.updated) === key) }))
      .filter((group) => group.items.length > 0)
  })

  const open = (chat: { server: ServerConnection.Key; id: string }) =>
    tabs.select(tabs.addSessionTab({ server: chat.server, sessionId: chat.id }))

  return (
    <HubPage title={language.t("hub.library.title")} description={language.t("hub.library.description")}>
      <div class="mb-6 flex items-center gap-2">
        <TextInputV2
          class="!w-auto !flex-1"
          appearance="large"
          leadingIcon={<Icon name="magnifying-glass" size="small" />}
          placeholder={language.t("hub.library.search")}
          aria-label={language.t("hub.library.search")}
          value={state.query}
          onInput={(event) => setState("query", event.currentTarget.value)}
        />
        <MenuV2 placement="bottom-end" gutter={4}>
          <MenuV2.Trigger
            as="button"
            type="button"
            class="flex h-8 max-w-56 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-v2-text-text-muted hover:bg-[var(--v2-glass-surface-hover)]"
          >
            <span class="truncate">
              {projects().find(([key]) => key === state.project)?.[1] ?? language.t("hub.library.allProjects")}
            </span>
            <Icon name="chevron-down" size="small" class="shrink-0" />
          </MenuV2.Trigger>
          <MenuV2.Portal>
            <MenuV2.Content class="max-h-80 min-w-[200px] overflow-y-auto">
              <MenuV2.RadioGroup value={state.project} onChange={(value) => setState("project", value)}>
                <MenuV2.RadioItem value="all">{language.t("hub.library.allProjects")}</MenuV2.RadioItem>
                <For each={projects()}>{([key, name]) => <MenuV2.RadioItem value={key}>{name}</MenuV2.RadioItem>}</For>
              </MenuV2.RadioGroup>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      </div>
      <Show
        when={groups().length > 0}
        fallback={
          <HubEmpty>
            {chats().length > 0 ? language.t("hub.library.noResults") : language.t("hub.library.empty")}
          </HubEmpty>
        }
      >
        <div class="flex flex-col gap-7">
          <For each={groups()}>
            {(group) => (
              <section class="flex flex-col gap-2">
                <h2 class="px-1 text-12-medium text-v2-text-text-faint">{language.t(`hub.library.${group.key}`)}</h2>
                <HubCard>
                  <For each={group.items}>
                    {(chat) => (
                      <button
                        type="button"
                        class="flex h-12 w-full min-w-0 items-center gap-3 border-b-[0.5px] border-v2-border-border-muted px-4 text-left transition-colors duration-150 last:border-b-0 hover:bg-[var(--v2-glass-surface-hover)]"
                        onClick={() => open(chat)}
                      >
                        <span class="min-w-0 flex-1 truncate text-[13px] font-[450] text-v2-text-text-base">
                          {chat.title}
                        </span>
                        <span class="flex shrink-0 items-center gap-1.5 text-12-regular text-v2-text-text-faint">
                          <Icon name="folder" size="small" />
                          <span class="max-w-40 truncate">{chat.projectName}</span>
                        </span>
                        <span class="w-16 shrink-0 text-right text-12-regular text-v2-text-text-faint">
                          {getRelativeTime(new Date(chat.updated).toISOString(), language.t)}
                        </span>
                      </button>
                    )}
                  </For>
                </HubCard>
              </section>
            )}
          </For>
        </div>
      </Show>
    </HubPage>
  )
}
