import { type Accessor, type Component, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Dialog } from "@codeink/ui/dialog"
import { Icon } from "@codeink/ui/icon"
import { IconButton } from "@codeink/ui/icon-button"
import { DialogBody, DialogHeader, DialogTitle, DialogV2 } from "@codeink/ui/v2/dialog-v2"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { LocalAgents } from "./local-agents"

export function useProviderConnectController(options: { onBack?: () => void } = {}) {
  const [store, setStore] = createStore({ selected: undefined as string | undefined })
  const reset = () => setStore("selected", undefined)

  return {
    selected: () => store.selected,
    select: (provider?: string) => setStore("selected", provider),
    back: options.onBack ?? reset,
  }
}

export const DialogConnectProvider: Component<{
  directory?: Accessor<string | undefined>
  controller?: ReturnType<typeof useProviderConnectController>
}> = (props) => {
  const fallback = useProviderConnectController()
  const controller = props.controller ?? fallback
  const language = useLanguage()
  const settings = useSettings()
  const newLayout = settings.general.newLayoutDesigns
  const reset = controller.back
  const back = { current: reset }
  let focusHost: HTMLDivElement | undefined
  const holdFocus = () => focusHost?.focus({ preventScroll: true })
  const select = (provider?: string) => {
    back.current = reset
    controller.select(provider)
  }

  function Content() {
    return <LocalAgents selected={controller.selected()} onSelect={select} />
  }

  return (
    <Show
      when={newLayout()}
      fallback={
        <Dialog
          class="h-full"
          transition
          title={
            <Show when={controller.selected()} fallback={language.t("command.provider.connect")}>
              <IconButton
                tabIndex={-1}
                icon="arrow-left"
                variant="ghost"
                onClick={() => back.current()}
                aria-label={language.t("common.goBack")}
              />
            </Show>
          }
        >
          <Content />
        </Dialog>
      }
    >
      <DialogV2
        containerClass="!h-[min(calc(100vh_-_16px),512px)] !w-[min(calc(100vw_-_16px),640px)]"
        class="[font-family:var(--v2-font-family-sans)] [&_[data-slot=dialog-header]]:!px-5 [&_[data-slot=dialog-header-title]]:!text-[15px] [&_[data-slot=dialog-header-title]]:!tracking-[-0.13px]"
      >
        <DialogHeader closeLabel={language.t("common.close")}>
          <Show
            when={controller.selected()}
            fallback={<DialogTitle>{language.t("command.provider.connect")}</DialogTitle>}
          >
            <button
              type="button"
              class="flex size-5 items-center justify-center rounded-sm text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
              onClick={() => back.current()}
              aria-label={language.t("common.goBack")}
            >
              <Icon name="arrow-left" size="small" />
            </button>
          </Show>
        </DialogHeader>
        <DialogBody class="min-h-0 flex-1 overflow-hidden px-2 pb-2">
          <div ref={focusHost} tabIndex={-1} class="flex min-h-0 flex-1 flex-col outline-none">
            <Content />
          </div>
        </DialogBody>
      </DialogV2>
    </Show>
  )
}
