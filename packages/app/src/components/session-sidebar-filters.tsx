import { createSignal, For, type JSX } from "solid-js"
import { Icon } from "@codeink/ui/v2/icon"
import { MenuV2 } from "@codeink/ui/v2/menu-v2"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"

const statusOptions = ["all", "activity", "attention"] as const
const statusLabels = {
  all: "sidebar.sessions.view.all",
  activity: "sidebar.sessions.status.active",
  attention: "sidebar.sessions.status.attention",
} as const
const groupOptions = ["project", "workspace", "status", "server", "recent", "type", "none"] as const
const groupLabels = {
  project: "sidebar.sessions.group.project",
  workspace: "sidebar.sessions.group.workspace",
  status: "sidebar.sessions.group.status",
  server: "sidebar.sessions.group.server",
  recent: "sidebar.sessions.group.recent",
  type: "sidebar.sessions.group.type",
  none: "sidebar.sessions.group.none",
} as const
const sortOptions = ["updated", "created", "title"] as const
const limitOptions = [3, 6, 10, 20, 0] as const

export type SessionSidebarControls = { expandAll(): void; collapseAll(): void }

export function SessionSidebarFilters(props: { controls: () => SessionSidebarControls | undefined }) {
  const language = useLanguage()
  const settings = useSettings()
  const [open, setOpen] = createSignal(false)
  const close = () => setOpen(false)

  return (
    <MenuV2 placement="bottom-end" gutter={4} open={open()} onOpenChange={setOpen}>
      <MenuV2.Trigger
        as="button"
        type="button"
        data-action="sidebar-filters"
        class="flex size-7 shrink-0 items-center justify-center rounded-md text-v2-icon-icon-muted hover:bg-[var(--v2-glass-surface-hover)] hover:text-v2-icon-icon-base"
        aria-label={language.t("sidebar.sessions.filters")}
      >
        <Icon name="outline-sliders" size="small" />
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content class="min-w-[232px]">
          <FilterSub
            action="sidebar-filter-status"
            label={language.t("sidebar.sessions.group.status")}
            current={language.t(statusLabels[settings.general.sidebarView()])}
          >
            <MenuV2.RadioGroup
              value={settings.general.sidebarView()}
              onChange={(value) => {
                const next = statusOptions.find((option) => option === value)
                if (next) settings.general.setSidebarView(next)
              }}
            >
              <For each={statusOptions}>
                {(option) => (
                  <MenuV2.RadioItem value={option} onSelect={close}>
                    {language.t(statusLabels[option])}
                  </MenuV2.RadioItem>
                )}
              </For>
            </MenuV2.RadioGroup>
          </FilterSub>
          <FilterSub
            action="sidebar-filter-group-by"
            label={language.t("sidebar.sessions.group.label")}
            current={language.t(groupLabels[settings.general.sidebarGroupBy()])}
          >
            <MenuV2.RadioGroup
              value={settings.general.sidebarGroupBy()}
              onChange={(value) => {
                const next = groupOptions.find((option) => option === value)
                if (next) settings.general.setSidebarGroupBy(next)
              }}
            >
              <For each={groupOptions}>
                {(option) => (
                  <MenuV2.RadioItem value={option} onSelect={close}>
                    {language.t(groupLabels[option])}
                  </MenuV2.RadioItem>
                )}
              </For>
            </MenuV2.RadioGroup>
          </FilterSub>
          <FilterSub
            action="sidebar-filter-sort"
            label={language.t("sidebar.sessions.sort.label")}
            current={language.t(`sidebar.sessions.sort.${settings.general.sidebarSort()}`)}
          >
            <MenuV2.RadioGroup
              value={settings.general.sidebarSort()}
              onChange={(value) => {
                const next = sortOptions.find((option) => option === value)
                if (next) settings.general.setSidebarSort(next)
              }}
            >
              <For each={sortOptions}>
                {(option) => (
                  <MenuV2.RadioItem value={option} onSelect={close}>
                    {language.t(`sidebar.sessions.sort.${option}`)}
                  </MenuV2.RadioItem>
                )}
              </For>
            </MenuV2.RadioGroup>
          </FilterSub>
          <FilterSub
            action="sidebar-filter-limit"
            label={language.t("sidebar.sessions.limit.label")}
            current={
              settings.general.sidebarChatLimit() === 0
                ? language.t("sidebar.sessions.limit.all")
                : String(settings.general.sidebarChatLimit())
            }
          >
            <MenuV2.RadioGroup
              value={String(settings.general.sidebarChatLimit())}
              onChange={(value) => settings.general.setSidebarChatLimit(Number(value))}
            >
              <For each={limitOptions}>
                {(option) => (
                  <MenuV2.RadioItem value={String(option)} onSelect={close}>
                    {option === 0 ? language.t("sidebar.sessions.limit.all") : String(option)}
                  </MenuV2.RadioItem>
                )}
              </For>
            </MenuV2.RadioGroup>
          </FilterSub>
          <MenuV2.Separator />
          <MenuV2.CheckboxItem
            data-action="sidebar-filter-timestamps"
            checked={settings.general.sidebarTimestamps()}
            onChange={(checked) => settings.general.setSidebarTimestamps(checked)}
          >
            {language.t("sidebar.sessions.timestamps")}
          </MenuV2.CheckboxItem>
          <MenuV2.Separator />
          <MenuV2.Item data-action="sidebar-expand-all" onSelect={() => props.controls()?.expandAll()}>
            {language.t("sidebar.sessions.expandAll")}
          </MenuV2.Item>
          <MenuV2.Item data-action="sidebar-collapse-all" onSelect={() => props.controls()?.collapseAll()}>
            {language.t("sidebar.sessions.collapseAll")}
          </MenuV2.Item>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

function FilterSub(props: { action: string; label: string; current: string; children: JSX.Element }) {
  return (
    <MenuV2.Sub gutter={0} overlap overflowPadding={8}>
      <MenuV2.SubTrigger data-action={props.action}>
        <span class="flex-1">{props.label}</span>
        <span class="text-v2-text-text-muted">{props.current}</span>
      </MenuV2.SubTrigger>
      <MenuV2.Portal>
        <MenuV2.SubContent>{props.children}</MenuV2.SubContent>
      </MenuV2.Portal>
    </MenuV2.Sub>
  )
}
