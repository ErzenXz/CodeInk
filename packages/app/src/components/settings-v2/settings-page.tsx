import { Component, createMemo, createSignal, Show, startTransition } from "solid-js"
import { useSearchParams } from "@solidjs/router"
import { TabsV2 } from "@codeink/ui/v2/tabs-v2"
import { Icon } from "@codeink/ui/icon"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { SettingsGeneralV2 } from "./general"
import { SettingsKeybinds } from "../settings-keybinds"
import { SettingsProvidersV2 } from "./providers"
import { SettingsModelsV2 } from "./models"
import "./settings-v2.css"
import { SettingsServersV2 } from "./servers"
import { useTabs } from "@/context/tabs"
import { useServerSync } from "@/context/server-sync"

const sections = [
  "general",
  "appearance",
  "shortcuts",
  "notifications",
  "sounds",
  "updates",
  "servers",
  "providers",
  "models",
]

const SettingsPage: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const tabs = useTabs()
  const serverSync = useServerSync()
  const [search] = useSearchParams<{ tab?: string; session?: string; draft?: string }>()
  const [tab, setTab] = createSignal(sections.includes(search.tab ?? "") ? search.tab! : "general")
  const directory = createMemo(() => {
    if (search.draft) {
      const draft = tabs.store.find((item) => item.type === "draft" && item.draftID === search.draft)
      return draft?.type === "draft" ? draft.directory : undefined
    }
    if (search.session) return serverSync().session.get(search.session)?.directory
    return undefined
  })

  const showProviders = () => setTab("providers")

  return (
    <div class="relative size-full overflow-hidden flex flex-col p-2">
      <div class="settings-v2-page" aria-label={language.t("sidebar.settings")}>
        <TabsV2
          orientation="vertical"
          variant="settings"
          value={tab()}
          onChange={(value) => void startTransition(() => setTab(value))}
          class="settings-v2"
        >
          <TabsV2.List>
            <div class="flex flex-col justify-between h-full w-full">
              <div class="flex flex-col gap-3 w-full">
                <div class="flex flex-col gap-3">
                  <div class="flex flex-col gap-1.5">
                    <TabsV2.SectionTitle>{language.t("settings.section.desktop")}</TabsV2.SectionTitle>
                    <div class="flex flex-col gap-1.5 w-full">
                      <TabsV2.Trigger value="general">
                        <Icon name="sliders" />
                        {language.t("settings.tab.general")}
                      </TabsV2.Trigger>
                      <TabsV2.Trigger value="appearance">
                        <Icon name="eye" />
                        {language.t("settings.general.section.appearance")}
                      </TabsV2.Trigger>
                      <TabsV2.Trigger value="shortcuts">
                        <Icon name="keyboard" />
                        {language.t("settings.tab.shortcuts")}
                      </TabsV2.Trigger>
                      <TabsV2.Trigger value="notifications">
                        <Icon name="status" />
                        {language.t("settings.general.section.notifications")}
                      </TabsV2.Trigger>
                      <TabsV2.Trigger value="sounds">
                        <Icon name="bubble-5" />
                        {language.t("settings.general.section.sounds")}
                      </TabsV2.Trigger>
                      <Show when={platform.platform === "desktop"}>
                        <TabsV2.Trigger value="updates">
                          <Icon name="download" />
                          {language.t("settings.general.section.updates")}
                        </TabsV2.Trigger>
                      </Show>
                    </div>
                  </div>

                  <div class="flex flex-col gap-1.5">
                    <TabsV2.SectionTitle>{language.t("command.category.agent")}</TabsV2.SectionTitle>
                    <div class="flex flex-col gap-1.5 w-full">
                      <TabsV2.Trigger value="providers">
                        <Icon name="providers" />
                        {language.t("settings.providers.title")}
                      </TabsV2.Trigger>
                      <TabsV2.Trigger value="models">
                        <Icon name="models" />
                        {language.t("settings.models.title")}
                      </TabsV2.Trigger>
                    </div>
                  </div>

                  <div class="flex flex-col gap-1.5">
                    <TabsV2.SectionTitle>{language.t("settings.section.server")}</TabsV2.SectionTitle>
                    <TabsV2.Trigger value="servers">
                      <Icon name="server" />
                      {language.t("status.popover.tab.servers")}
                    </TabsV2.Trigger>
                  </div>
                </div>
              </div>
              <div class="settings-v2-nav-footer">
                <span>{language.t("app.name.desktop")}</span>
                <span>v{platform.version}</span>
              </div>
            </div>
          </TabsV2.List>
          <TabsV2.Content value="general" class="settings-v2-panel">
            <SettingsGeneralV2 section="general" sessionID={search.session} />
          </TabsV2.Content>
          <TabsV2.Content value="appearance" class="settings-v2-panel">
            <SettingsGeneralV2 section="appearance" sessionID={search.session} />
          </TabsV2.Content>
          <TabsV2.Content value="shortcuts" class="settings-v2-panel">
            <SettingsKeybinds v2 />
          </TabsV2.Content>
          <TabsV2.Content value="notifications" class="settings-v2-panel">
            <SettingsGeneralV2 section="notifications" sessionID={search.session} />
          </TabsV2.Content>
          <TabsV2.Content value="sounds" class="settings-v2-panel">
            <SettingsGeneralV2 section="sounds" sessionID={search.session} />
          </TabsV2.Content>
          <TabsV2.Content value="updates" class="settings-v2-panel">
            <SettingsGeneralV2 section="updates" sessionID={search.session} />
          </TabsV2.Content>
          <TabsV2.Content value="servers" class="settings-v2-panel">
            <SettingsServersV2 />
          </TabsV2.Content>
          <TabsV2.Content value="providers" class="settings-v2-panel">
            <SettingsProvidersV2 directory={directory} onBack={showProviders} />
          </TabsV2.Content>
          <TabsV2.Content value="models" class="settings-v2-panel">
            <SettingsModelsV2 />
          </TabsV2.Content>
        </TabsV2>
      </div>
    </div>
  )
}

export default SettingsPage
