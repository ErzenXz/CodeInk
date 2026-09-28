import { type Component, createResource, For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Tag } from "@codeink/ui/v2/badge-v2"
import { ButtonV2 } from "@codeink/ui/v2/button-v2"
import { ProviderIcon } from "@codeink/ui/provider-icon"
import { useLanguage } from "@/context/language"
import { usePlatform, type AgentLimitWindow, type AgentUsageReport } from "@/context/platform"
import { getRelativeTime } from "@/utils/time"
import { showToast } from "@/utils/toast"
import "./settings-v2.css"

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 })
const currency = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 })
const resetTime = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })

export const SettingsUsageV2: Component = () => {
  const platform = usePlatform()
  const language = useLanguage()
  const [monitoring, setMonitoring] = createStore({ enabled: undefined as boolean | undefined, saving: false })
  const [reports, { refetch }] = createResource(
    () => monitoring.enabled === true,
    (_, info): Promise<AgentUsageReport[]> =>
      platform.agentWorkspace?.usage(info.refetching === true) ?? Promise.resolve([]),
  )
  // Read through `state` so loading never suspends the settings page.
  const loaded = () => (reports.state === "ready" || reports.state === "refreshing" ? reports.latest : undefined)
  const ago = (time: number) => getRelativeTime(new Date(time).toISOString(), language.t)
  onMount(() => {
    if (!platform.agentWorkspace) return
    void platform.agentWorkspace.usageMonitoringEnabled()
      .then((enabled) => setMonitoring("enabled", enabled))
      .catch(() => setMonitoring("enabled", false))
    const unsubscribe = platform.agentWorkspace.onUsageMonitoringChange((enabled) => setMonitoring("enabled", enabled))
    const timer = setInterval(() => {
      if (monitoring.enabled && !reports.loading) void refetch()
    }, 5 * 60_000)
    onCleanup(() => clearInterval(timer))
    onCleanup(unsubscribe)
  })

  const setEnabled = async (enabled: boolean) => {
    if (!platform.agentWorkspace || monitoring.saving) return
    setMonitoring("saving", true)
    await platform.agentWorkspace.setUsageMonitoringEnabled(enabled)
      .then((value) => setMonitoring("enabled", value))
      .catch((cause: unknown) => showToast({
        title: language.t("common.requestFailed"),
        description: cause instanceof Error ? cause.message : String(cause),
      }))
      .finally(() => setMonitoring("saving", false))
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <div class="flex items-center justify-between gap-4">
          <h2 class="settings-v2-tab-title">{language.t("settings.usage.title")}</h2>
          <Show when={monitoring.enabled}>
            <div class="flex items-center gap-2">
              <ButtonV2 variant="outline" size="small" disabled={monitoring.saving} onClick={() => void setEnabled(false)}>
                {language.t("settings.usage.turnOff")}
              </ButtonV2>
              <ButtonV2 variant="outline" size="small" icon="reset" disabled={reports.loading} onClick={() => refetch()}>
                {language.t("hub.refresh")}
              </ButtonV2>
            </div>
          </Show>
        </div>
      </div>
      <div class="settings-v2-tab-body">
        <p class="text-[13px] leading-5 text-v2-text-text-muted">{language.t("settings.usage.description")}</p>
        <Show when={platform.agentWorkspace} fallback={<p class="text-[13px]">{language.t("hub.desktopOnly")}</p>}>
          <Show when={monitoring.enabled === false}>
            <section class="flex flex-col gap-3 rounded-xl border border-v2-border-border-muted p-4">
              <h3 class="text-[13px] font-semibold text-v2-text-text-base">{language.t("settings.usage.consentTitle")}</h3>
              <p class="text-[12px] leading-5 text-v2-text-text-muted">{language.t("settings.usage.consentDescription")}</p>
              <p class="text-[12px] leading-5 text-v2-text-text-muted">{language.t("settings.usage.consentKeychain")}</p>
              <div>
                <ButtonV2 variant="contrast" size="small" disabled={monitoring.saving} onClick={() => void setEnabled(true)}>
                  {language.t("settings.usage.turnOn")}
                </ButtonV2>
              </div>
            </section>
          </Show>
          <Show when={monitoring.enabled}>
            <Show
              when={loaded()}
              fallback={
                <For each={[0, 1]}>{() => <div class="h-32 animate-pulse border-b border-v2-border-border-muted" />}</For>
              }
            >
              <Show
                when={(loaded() ?? []).length > 0}
                fallback={<p class="text-[13px] text-v2-text-text-muted">{language.t("settings.usage.empty")}</p>}
              >
                <For each={loaded()}>{(report) => <UsageCard report={report} ago={ago} />}</For>
              </Show>
            </Show>
          </Show>
        </Show>
      </div>
    </>
  )
}

function UsageCard(props: { report: AgentUsageReport; ago: (time: number) => string }) {
  const language = useLanguage()
  const stale = () =>
    !!props.report.stale ||
    (props.report.expiresAt !== undefined && Date.now() >= props.report.expiresAt) ||
    (!!props.report.fetchedAt && Date.now() - props.report.fetchedAt >= 10 * 60_000)
  const windows = () =>
    stale() ? [] : props.report.windows.filter((window) => !window.resetsAt || window.resetsAt > Date.now())
  const stats = () => [
    { label: language.t("settings.usage.stat.chats"), value: String(props.report.totals.sessions) },
    { label: language.t("settings.usage.stat.input"), value: compact.format(props.report.totals.input) },
    { label: language.t("settings.usage.stat.output"), value: compact.format(props.report.totals.output) },
    ...(props.report.totals.cost === undefined
      ? []
      : [{ label: language.t("settings.usage.stat.cost"), value: currency.format(props.report.totals.cost) }]),
    {
      label: language.t("settings.usage.stat.lastUsed"),
      value: props.report.totals.lastUsed ? props.ago(props.report.totals.lastUsed) : "—",
    },
  ]
  const iconID = () => props.report.agentID.startsWith("openusage:")
    ? props.report.agentID.slice("openusage:".length).split(":")[0]
    : props.report.agentID

  return (
    <section class="border-b border-v2-border-border-muted pb-5 last:border-b-0" data-component="settings-usage-report">
      <div class="flex items-center gap-2.5 pb-4">
        <ProviderIcon id={`local-${iconID()}`} class="size-4 shrink-0" />
        <h3 class="text-[13px] font-semibold text-v2-text-text-base">{props.report.name}</h3>
        <Show when={!stale() && props.report.plan}>{(plan) => <Tag>{plan()}</Tag>}</Show>
        <span class="ms-auto text-[11px] text-v2-text-text-faint">
          <Show when={props.report.fetchedAt}>
            {(time) => language.t("settings.usage.updated", { time: props.ago(time()) })}
          </Show>
        </span>
        <Show when={stale()}>
          <Tag>{language.t("settings.usage.outdated")}</Tag>
        </Show>
      </div>
      <Show when={props.report.error && windows().length > 0}>
        <p class="text-[11px] text-v2-text-text-muted">{language.t("settings.usage.refreshFailed")}</p>
      </Show>
      <div class="flex flex-col gap-3">
        <Show
          when={windows().length > 0}
          fallback={
            <Show when={stale() || !props.report.metrics?.length}>
              <p class="text-[12px] leading-5 text-v2-text-text-muted">
                {props.report.error
                  ? language.t("settings.usage.refreshFailed")
                  : stale() && props.report.windows.length > 0
                    ? language.t(
                        props.report.source === "cache"
                          ? "settings.usage.staleLimits"
                          : "settings.usage.staleOtherLimits",
                      )
                    : props.report.source === "cache" && props.report.windows.length > 0
                      ? language.t("settings.usage.expiredLimits")
                      : language.t("settings.usage.noLimits")}
              </p>
            </Show>
          }
        >
          <For each={windows()}>{(window) => <LimitBar window={window} />}</For>
        </Show>
      </div>
      <Show when={!stale() && props.report.metrics?.length}>
        <div class="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          <For each={props.report.metrics}>{(metric) => (
            <div class="flex items-baseline gap-1.5">
              <span class="text-[11px] text-v2-text-text-faint">{metric.id}</span>
              <span class="text-[12px] font-medium tabular-nums text-v2-text-text-base">
                {metric.unit === "usd" ? currency.format(metric.value) : `${compact.format(metric.value)} ${metric.unit}`}
              </span>
            </div>
          )}</For>
        </div>
      </Show>
      <Show when={!props.report.agentID.startsWith("openusage:") || props.report.totals.sessions > 0}>
        <div class="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-v2-border-border-muted pt-3">
          <For each={stats()}>
            {(stat) => (
              <div class="flex items-baseline gap-1.5 whitespace-nowrap">
                <span class="text-[11px] text-v2-text-text-faint">{stat.label}</span>
                <span class="text-[12px] font-medium tabular-nums text-v2-text-text-base">{stat.value}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  )
}

function LimitBar(props: { window: AgentLimitWindow }) {
  const language = useLanguage()
  // A cached snapshot older than its window's reset no longer applies; the window started over.
  const expired = () => props.window.resetsAt !== undefined && props.window.resetsAt < Date.now()
  const used = () => (expired() ? 0 : Math.min(100, Math.max(0, props.window.usedPercent)))
  const title = () => {
    const base = language.t(`settings.usage.window.${props.window.kind}`)
    return props.window.label ? `${base} · ${props.window.label}` : base
  }
  const tone = () =>
    used() >= 90
      ? "var(--v2-state-fg-danger)"
      : used() >= 75 || props.window.warning
        ? "var(--v2-state-fg-warning)"
        : "var(--v2-background-bg-accent)"

  return (
    <div class="flex flex-col gap-1.5">
      <div class="flex items-baseline justify-between gap-3">
        <span class="text-[12px] font-medium text-v2-text-text-base">{title()}</span>
        <span class="text-[11px] tabular-nums text-v2-text-text-muted">
          {language.t("settings.usage.used", { percent: String(Math.round(used())) })}
        </span>
      </div>
      <div class="h-1 overflow-hidden rounded-full bg-[var(--v2-glass-surface-pressed)]">
        <div
          class="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${used()}%`, background: tone() }}
        />
      </div>
      <Show when={!expired() && props.window.resetsAt}>
        {(time) => (
          <span class="text-[11px] text-v2-text-text-faint">
            {language.t("settings.usage.resets", { time: resetTime.format(time()) })}
          </span>
        )}
      </Show>
    </div>
  )
}
