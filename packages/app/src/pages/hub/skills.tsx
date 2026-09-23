import { createMemo, createResource, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@codeink/ui/v2/icon"
import { IconButtonV2 } from "@codeink/ui/v2/icon-button-v2"
import { MenuV2 } from "@codeink/ui/v2/menu-v2"
import { Switch } from "@codeink/ui/v2/switch-v2"
import { TextInputV2 } from "@codeink/ui/v2/text-input-v2"
import { useLanguage } from "@/context/language"
import { usePlatform, type AgentExtension, type AgentExtensionReport } from "@/context/platform"
import { showToast } from "@/utils/toast"
import { AgentIcon, HubEmpty, HubPage } from "./hub-page"

const kinds = ["skill", "plugin", "mcp"] as const
const scopes = ["user", "system", "repo", "admin"] as const
const statuses = ["connected", "starting", "failed", "authenticationRequired", "disabled"] as const
// Last loaded list, so returning to the page renders immediately while it refreshes.
let lastReports: AgentExtensionReport[] | undefined

export default function SkillsPage() {
  const platform = usePlatform()
  const language = useLanguage()
  const [reports, { refetch }] = createResource(
    async (_, info): Promise<AgentExtensionReport[]> =>
      (lastReports = (await platform.agentWorkspace?.extensions(info.refetching === true)) ?? []),
    { initialValue: lastReports },
  )
  // Read through `state` so a first load never suspends the route; the skeleton shows instead.
  const loaded = () => (reports.state === "ready" || reports.state === "refreshing" ? reports.latest : undefined)
  const [state, setState] = createStore({
    kind: "skill" as AgentExtension["kind"],
    agent: "all",
    query: "",
    // Optimistic enabled state while the agent applies a toggle.
    overrides: {} as Record<string, boolean>,
    // Cards rendered so far; the first frame only builds what fits on screen.
    limit: 16,
  })
  const reveal = () => {
    setState("limit", 16)
    requestAnimationFrame(() => requestAnimationFrame(() => setState("limit", Infinity)))
  }
  onMount(reveal)

  const matches = (item: AgentExtension) => {
    const needle = state.query.trim().toLowerCase()
    return (
      !needle ||
      item.name.toLowerCase().includes(needle) ||
      (item.description ?? "").toLowerCase().includes(needle) ||
      (item.source ?? "").toLowerCase().includes(needle)
    )
  }
  const scoped = createMemo(() =>
    (loaded() ?? []).filter((report) => state.agent === "all" || report.agentID === state.agent),
  )
  const count = (kind: AgentExtension["kind"]) =>
    scoped()
      .flatMap((report) => report.extensions)
      .filter((item) => item.kind === kind && matches(item)).length
  const sections = createMemo(() =>
    scoped()
      .map((report) => ({
        ...report,
        items: report.extensions
          .filter((item) => item.kind === state.kind && matches(item))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .filter((report) => report.items.length > 0),
  )
  const budgets = createMemo(() => {
    let left = state.limit
    return new Map(
      sections().map((section) => {
        const count = Math.max(0, Math.min(section.items.length, left))
        left -= count
        return [section.agentID, count] as const
      }),
    )
  })

  const toggle = async (item: AgentExtension, enabled: boolean) => {
    const key = `${item.agentID}\n${item.id}`
    setState("overrides", key, enabled)
    await platform.agentWorkspace
      ?.setExtensionEnabled({ agentID: item.agentID, kind: item.kind, id: item.id, path: item.path, enabled })
      .catch((cause: unknown) => {
        setState("overrides", key, !enabled)
        showToast({
          title: language.t("common.requestFailed"),
          description: cause instanceof Error ? cause.message : String(cause),
        })
      })
  }

  const sourceLabel = (item: AgentExtension) => {
    const scope = scopes.find((value) => value === item.source)
    if (scope) return language.t(`hub.skills.scope.${scope}`)
    // Marketplace ids read as `plugin@marketplace`; the plugin name is the useful part.
    return item.source?.split("@")[0]
  }

  return (
    <HubPage
      title={language.t("hub.skills.title")}
      description={language.t("hub.skills.description")}
      actions={
        <>
          <TextInputV2
            class="!w-60"
            leadingIcon={<Icon name="magnifying-glass" size="small" />}
            placeholder={language.t("hub.skills.search")}
            aria-label={language.t("hub.skills.search")}
            value={state.query}
            onInput={(event) => setState("query", event.currentTarget.value)}
          />
          <IconButtonV2
            variant="ghost"
            icon={<Icon name="reset" size="small" />}
            aria-label={language.t("hub.refresh")}
            disabled={reports.loading}
            onClick={() => refetch()}
          />
        </>
      }
    >
      <Show when={platform.agentWorkspace} fallback={<HubEmpty>{language.t("hub.desktopOnly")}</HubEmpty>}>
        <div class="mb-6 flex items-end justify-between gap-4 border-b-[0.5px] border-v2-border-border-base">
          <div class="flex items-end gap-6" role="tablist">
            <For each={kinds}>
              {(kind) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={state.kind === kind}
                  class="-mb-px flex h-10 items-center gap-1.5 border-b-2 text-[13px] font-[530] transition-colors duration-150"
                  classList={{
                    "border-v2-text-text-base text-v2-text-text-base": state.kind === kind,
                    "border-transparent text-v2-text-text-muted hover:text-v2-text-text-base": state.kind !== kind,
                  }}
                  onClick={() => {
                    setState("kind", kind)
                    reveal()
                  }}
                >
                  {language.t(`hub.skills.tab.${kind}`)}
                  <span class="rounded-full bg-[var(--v2-glass-surface-hover)] px-1.5 text-[11px] leading-4 tabular-nums text-v2-text-text-muted">
                    {count(kind)}
                  </span>
                </button>
              )}
            </For>
          </div>
          <MenuV2 placement="bottom-end" gutter={4}>
            <MenuV2.Trigger
              as="button"
              type="button"
              class="mb-1.5 flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-v2-text-text-muted hover:bg-[var(--v2-glass-surface-hover)]"
            >
              <Show when={state.agent !== "all"}>
                <AgentIcon agentID={state.agent} class="size-3.5 shrink-0" />
              </Show>
              {(loaded() ?? []).find((report) => report.agentID === state.agent)?.name ?? language.t("hub.allAgents")}
              <Icon name="chevron-down" size="small" />
            </MenuV2.Trigger>
            <MenuV2.Portal>
              <MenuV2.Content class="min-w-[180px]">
                <MenuV2.RadioGroup
                  value={state.agent}
                  onChange={(value) => {
                    setState("agent", value)
                    reveal()
                  }}
                >
                  <MenuV2.RadioItem value="all">{language.t("hub.allAgents")}</MenuV2.RadioItem>
                  <For each={loaded() ?? []}>
                    {(report) => <MenuV2.RadioItem value={report.agentID}>{report.name}</MenuV2.RadioItem>}
                  </For>
                </MenuV2.RadioGroup>
              </MenuV2.Content>
            </MenuV2.Portal>
          </MenuV2>
        </div>
        <For each={(loaded() ?? []).filter((report) => report.error)}>
          {(report) => (
            <p class="mb-4 rounded-lg bg-v2-state-bg-danger px-3 py-2 text-12-regular text-v2-state-fg-danger">
              {language.t("hub.loadFailed", { name: report.name, error: report.error ?? "" })}
            </p>
          )}
        </For>
        <Show when={loaded()} fallback={<SkeletonGrid />}>
          <Show when={(loaded() ?? []).length > 0} fallback={<HubEmpty>{language.t("hub.skills.noAgents")}</HubEmpty>}>
            <Show when={sections().length > 0} fallback={<HubEmpty>{language.t("hub.skills.empty")}</HubEmpty>}>
              <div class="flex flex-col gap-8 [--v2-background-bg-accent:var(--v2-background-bg-inverse)]">
                <For each={sections()}>
                  {(section) => (
                    <section class="flex flex-col gap-3">
                      <h2 class="flex items-center gap-2 px-0.5 text-[13px] font-[560] text-v2-text-text-base">
                        <AgentIcon agentID={section.agentID} />
                        {section.name}
                        <span class="font-[440] tabular-nums text-v2-text-text-faint">{section.items.length}</span>
                      </h2>
                      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <For each={section.items.slice(0, budgets().get(section.agentID) ?? 0)}>
                          {(item) => (
                            <ExtensionCard
                              item={item}
                              source={sourceLabel(item)}
                              enabled={state.overrides[`${item.agentID}\n${item.id}`] ?? item.enabled ?? true}
                              onToggle={(enabled) => void toggle(item, enabled)}
                            />
                          )}
                        </For>
                      </div>
                    </section>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </Show>
    </HubPage>
  )
}

function ExtensionCard(props: {
  item: AgentExtension
  source?: string
  enabled: boolean
  onToggle: (enabled: boolean) => void
}) {
  const language = useLanguage()
  const status = () => statuses.find((value) => value === props.item.status)
  const meta = () =>
    [
      props.source,
      props.item.version && `v${props.item.version}`,
      props.item.kind === "mcp" && props.item.tools !== undefined
        ? language.t("hub.skills.tools", { count: String(props.item.tools) })
        : undefined,
    ]
      .filter(Boolean)
      .join(" · ")

  return (
    <div
      class="flex min-w-0 flex-col gap-3 rounded-xl bg-v2-background-bg-base p-4 shadow-[var(--v2-glass-shadow-raised)] transition-[box-shadow,opacity] duration-150 hover:shadow-[var(--v2-glass-shadow-floating)]"
      classList={{ "opacity-55": !props.enabled }}
    >
      <div class="flex min-w-0 items-start gap-3">
        <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--v2-glass-surface-hover)] text-[15px] font-semibold uppercase text-v2-text-text-muted">
          {props.item.name.replace(/[^a-z0-9]/gi, "").charAt(0)}
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
          <span class="truncate text-[13.5px] font-[560] leading-5 text-v2-text-text-base">{props.item.name}</span>
          <Show when={meta()}>
            <span class="truncate text-[11.5px] leading-4 text-v2-text-text-faint">{meta()}</span>
          </Show>
        </div>
        <Show when={props.item.toggleable}>
          <Switch checked={props.enabled} onChange={props.onToggle} hideLabel>
            {language.t("hub.skills.toggle", { name: props.item.name })}
          </Switch>
        </Show>
        <Show when={!props.item.toggleable && status()}>
          {(value) => (
            <span class="shrink-0 rounded-full bg-[var(--v2-glass-surface-hover)] px-2 py-0.5 text-[11px] font-[530] text-v2-text-text-muted">
              {language.t(`hub.skills.status.${value()}`)}
            </span>
          )}
        </Show>
        <Show when={!props.item.toggleable && !status() && !props.enabled}>
          <span class="shrink-0 rounded-full bg-[var(--v2-glass-surface-hover)] px-2 py-0.5 text-[11px] font-[530] text-v2-text-text-muted">
            {language.t("hub.skills.off")}
          </span>
        </Show>
      </div>
      <Show when={props.item.description}>
        <p class="line-clamp-2 text-12-regular leading-[18px] text-v2-text-text-muted">{props.item.description}</p>
      </Show>
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
      <For each={[0, 1, 2, 3, 4, 5]}>
        {() => (
          <div class="flex h-[104px] animate-pulse flex-col gap-3 rounded-xl bg-v2-background-bg-base p-4 shadow-[var(--v2-glass-shadow-raised)]">
            <div class="flex items-center gap-3">
              <div class="size-9 rounded-lg bg-[var(--v2-glass-surface-pressed)]" />
              <div class="h-3 w-32 rounded-full bg-[var(--v2-glass-surface-pressed)]" />
            </div>
            <div class="h-2.5 w-4/5 rounded-full bg-[var(--v2-glass-surface-hover)]" />
          </div>
        )}
      </For>
    </div>
  )
}
