import { type Component, createResource, For, Show } from "solid-js"
import { Tag } from "@codeink/ui/v2/badge-v2"
import { ButtonV2 } from "@codeink/ui/v2/button-v2"
import { ProviderIcon } from "@codeink/ui/provider-icon"
import { useLanguage } from "@/context/language"
import { usePlatform, type AgentLimitWindow, type AgentUsageReport } from "@/context/platform"
import { getRelativeTime } from "@/utils/time"
import "./settings-v2.css"

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 })
const currency = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 })
const resetTime = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })

export const SettingsUsageV2: Component = () => {
  const platform = usePlatform()
  const language = useLanguage()
  const [reports, { refetch }] = createResource(
    (_, info): Promise<AgentUsageReport[]> =>
      platform.agentWorkspace?.usage(info.refetching === true) ?? Promise.resolve([]),
  )
  // Read through `state` so loading never suspends the settings page.
  const loaded = () => (reports.state === "ready" || reports.state === "refreshing" ? reports.latest : undefined)
  const ago = (time: number) => getRelativeTime(new Date(time).toISOString(), language.t)

  return (
    <>
      <div class="settings-v2-tab-header">
        <div class="flex items-center justify-between gap-4">
          <h2 class="settings-v2-tab-title">{language.t("settings.usage.title")}</h2>
          <ButtonV2 variant="outline" size="small" icon="reset" disabled={reports.loading} onClick={() => refetch()}>
            {language.t("hub.refresh")}
          </ButtonV2>
        </div>
      </div>
      <div class="settings-v2-tab-body">
        <p class="-mt-4 text-[13px] leading-5 text-v2-text-text-muted">{language.t("settings.usage.description")}</p>
        <Show when={platform.agentWorkspace} fallback={<p class="text-[13px]">{language.t("hub.desktopOnly")}</p>}>
          <Show
            when={loaded()}
            fallback={
              <For each={[0, 1]}>{() => <div data-component="settings-v2-list" class="h-56 animate-pulse" />}</For>
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
      </div>
    </>
  )
}

function UsageCard(props: { report: AgentUsageReport; ago: (time: number) => string }) {
  const language = useLanguage()
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

  return (
    <div data-component="settings-v2-list" class="!px-0">
      <div class="flex items-center gap-3 px-[22px] pb-3 pt-5">
        <ProviderIcon id={`local-${props.report.agentID}`} class="size-5 shrink-0" />
        <span class="text-[14px] font-[560] text-v2-text-text-base">{props.report.name}</span>
        <Show when={props.report.plan}>{(plan) => <Tag variant="accent">{plan()}</Tag>}</Show>
        <span class="ms-auto text-12-regular text-v2-text-text-faint">
          <Show when={props.report.source === "live"}>{language.t("settings.usage.live")}</Show>
          <Show when={props.report.source === "cache" && props.report.fetchedAt}>
            {(time) => language.t("settings.usage.updated", { time: props.ago(time()) })}
          </Show>
        </span>
      </div>
      <div class="flex flex-col gap-4 px-[22px] pb-5">
        <Show
          when={props.report.windows.length > 0}
          fallback={
            <p class="text-[13px] leading-5 text-v2-text-text-muted">
              {props.report.error ?? language.t("settings.usage.noLimits")}
            </p>
          }
        >
          <For each={props.report.windows}>{(window) => <LimitBar window={window} />}</For>
        </Show>
      </div>
      <div class="grid grid-cols-2 border-t-[0.5px] border-v2-border-border-muted sm:grid-cols-5">
        <For each={stats()}>
          {(stat) => (
            <div class="flex flex-col gap-1 px-[22px] py-3.5">
              <span class="text-[11px] text-v2-text-text-faint">{stat.label}</span>
              <span class="text-[14px] font-[560] tabular-nums text-v2-text-text-base">{stat.value}</span>
            </div>
          )}
        </For>
      </div>
    </div>
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
    <div class="flex flex-col gap-2">
      <div class="flex items-baseline justify-between gap-3">
        <span class="text-[13px] font-[530] text-v2-text-text-base">{title()}</span>
        <span class="text-12-regular tabular-nums text-v2-text-text-muted">
          {language.t("settings.usage.used", { percent: String(Math.round(used())) })}
        </span>
      </div>
      <div class="h-2 overflow-hidden rounded-full bg-[var(--v2-glass-surface-pressed)]">
        <div
          class="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${used()}%`, background: tone() }}
        />
      </div>
      <Show when={!expired() && props.window.resetsAt}>
        {(time) => (
          <span class="text-12-regular text-v2-text-text-faint">
            {language.t("settings.usage.resets", { time: resetTime.format(time()) })}
          </span>
        )}
      </Show>
    </div>
  )
}
