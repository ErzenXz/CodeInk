import { Icon } from "@codeink/ui/v2/icon"
import { IconButtonV2 } from "@codeink/ui/v2/icon-button-v2"
import { isRTL } from "@kobalte/core/i18n"
import { useNavigate } from "@solidjs/router"
import { createSignal, Show } from "solid-js"
import { Drawer, DrawerClose, DrawerContent, DrawerTrigger } from "@/components/ui/drawer"
import { usePlatform } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { useLanguage } from "@/context/language"
import agentArtwork from "@/assets/help/codeink-agent.webp"

export function AgentInfoPopup() {
  const settings = useSettings()
  const platform = usePlatform()
  const language = useLanguage()
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = createSignal(false)
  const windows = () => platform.platform === "desktop" && platform.os === "windows"
  const rtl = () => isRTL(language.intl())

  return (
    <Drawer
      open={drawerOpen()}
      // New Chat may focus its composer while the drawer opens; keep the drawer visible.
      closeOnOutsideFocus={false}
      onOpenChange={(open) => {
        setDrawerOpen(open)
        if (!open) settings.general.dismissAgentToast()
      }}
      side={rtl() ? "left" : "right"}
    >
      <Show when={settings.general.shouldDisplayAgentToast()}>
        <div
          class="fixed bottom-5 end-5 z-50 h-[240px] w-[192px] rounded-xl glass p-1 shadow-[var(--v2-elevation-floating)]"
          aria-label={language.t("help.agent.toast.ariaLabel")}
        >
          <button
            type="button"
            aria-label={language.t("help.agent.toast.dismiss")}
            class="absolute top-3 end-3 z-10 size-5 flex items-center justify-center rounded-sm bg-[rgba(0,0,0,0.4)]"
            style={{ color: "#fff" }}
            onClick={settings.general.dismissAgentToast}
          >
            <Icon name="xmark-small" size="small" />
          </button>
          <DrawerTrigger
            type="button"
            class="relative block h-[232px] w-[184px] cursor-pointer overflow-hidden rounded-sm text-start"
          >
            <img src={agentArtwork} alt="" class="absolute inset-0 size-full object-cover" />
            <div class="absolute inset-x-0 bottom-0 flex w-full flex-col items-start gap-1.5 bg-[linear-gradient(180deg,rgba(0,0,0,0)_0%,#000000_100%)] px-3 py-5">
              <p
                class="w-full select-none text-[13px] font-[530] leading-none tracking-[-0.04px]"
                style={{ color: "#fff" }}
              >
                {language.t("help.agent.title")}
              </p>
              <p
                class="w-full select-none text-[13px] font-[440] leading-[140%] tracking-[-0.04px]"
                style={{ color: "#d0d8e8" }}
              >
                {language.t("help.agent.description")}
              </p>
            </div>
          </DrawerTrigger>
        </div>
      </Show>
      <DrawerContent
        style={
          windows()
            ? {
                top: "0",
                bottom: "0",
                "inset-inline-end": "0",
                "inset-inline-start": "auto",
                "max-height": "100vh",
                "max-width": "100vw",
                "border-radius": "0",
              }
            : undefined
        }
      >
        <Show when={windows()}>
          <DrawerClose
            as={IconButtonV2}
            type="button"
            size="small"
            variant="neutral"
            aria-label={language.t("common.close")}
            icon={<Icon name="xmark-small" />}
            class="absolute top-[10px] start-[-36px]"
          />
        </Show>
        <div class="flex h-[52px] w-full shrink-0 items-center gap-4 self-stretch border-b border-v2-border-border-muted p-4">
          <p class="min-w-0 flex-1 text-[13px] font-[530] text-v2-text-text-muted">
            {language.t("help.agent.eyebrow")}
          </p>
          <Show when={!windows()}>
            <DrawerClose
              as={IconButtonV2}
              type="button"
              size="small"
              variant="ghost-muted"
              aria-label={language.t("common.close")}
              icon={<Icon name="xmark-small" />}
            />
          </Show>
        </div>
        <div class="flex min-h-0 w-full flex-1 flex-col gap-5 overflow-y-auto p-8">
          <h2 class="text-[21px] font-[610] leading-6 text-v2-text-text-base">{language.t("help.agent.title")}</h2>
          <p class="text-[13px] leading-5 text-v2-text-text-base">{language.t("help.agent.introduction")}</p>
          <img src={agentArtwork} alt="" class="aspect-[4/3] w-full rounded-lg object-cover object-[center_35%]" />
          <div class="flex items-center gap-3 rounded-lg border border-v2-border-border-muted p-4 text-v2-text-text-base">
            <span aria-hidden="true" class="font-mono text-[16px] leading-none">
              &gt;_
            </span>
            <span class="text-[13px] leading-5">{language.t("help.agent.terminal")}</span>
          </div>
          <p class="text-[13px] leading-5 text-v2-text-text-muted">{language.t("help.agent.keys")}</p>
          <button
            type="button"
            class="w-fit rounded-md bg-v2-text-text-base px-3 py-2 text-[13px] font-medium text-v2-background-bg-base"
            onClick={() => {
              settings.general.dismissAgentToast()
              setDrawerOpen(false)
              navigate("/settings?tab=codeink-agent")
            }}
          >
            {language.t("help.agent.setup")}
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
