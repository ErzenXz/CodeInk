import { useDialog } from "@codeink/ui/context/dialog"
import { Tooltip } from "@codeink/ui/tooltip"
import { Icon as IconV2 } from "@codeink/ui/v2/icon"
import { TooltipV2 } from "@codeink/ui/v2/tooltip-v2"
import { Show, createMemo, createSignal, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { Portal } from "solid-js/web"
import createPresence from "solid-presence"
import { PromptInputV2Composer } from "@/components/prompt-input-v2"
import { PromptGitStatus, PromptWorkspaceSelector } from "@/components/prompt-workspace-selector"
import {
  PromptProjectAddButton,
  PromptProjectSelector,
  type PromptProjectController,
} from "@/components/prompt-project-selector"
import { StatusPopoverV2 } from "@/components/status-popover"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useServerSync } from "@/context/server-sync"
import { useServerSDK } from "@/context/server-sdk"
import { ServerConnection, serverName } from "@/context/server"
import { useProviders } from "@/hooks/use-providers"
import { NEW_SESSION_CONTENT_WIDTH } from "@/pages/session/new-session-layout"
import { Persist, persisted } from "@/utils/persist"
import type { NewSessionDraftController } from "./new-session-draft-controller"
import type { NewSessionWorkspaceController } from "./new-session-workspace-controller"

const providerTipDismissalDuration = 30 * 24 * 60 * 60 * 1000

export function NewSessionView(props: {
  input: NewSessionDraftController["input"]
  project: PromptProjectController
  workspace: NewSessionWorkspaceController
}) {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const serverLabel = () =>
    ServerConnection.local(serverSDK().server)
      ? language.t("session.new.workspace.triggerLocal")
      : serverName(serverSDK().server)

  return (
    <div class="@container relative flex flex-col min-h-0 h-full flex-1">
      <div
        data-component="session-new-design"
        class="relative flex-1 min-h-0 overflow-hidden rounded-xl bg-v2-background-bg-deep group-data-[shell=sidebar]/shell:rounded-none group-data-[shell=sidebar]/shell:bg-v2-background-bg-base group-data-[shell=sidebar]/shell:shadow-[inset_0.5px_0_0_var(--v2-border-border-muted)]"
      >
        <div class="absolute inset-0 flex items-center justify-center px-3 sm:px-6">
          <div class={NEW_SESSION_CONTENT_WIDTH}>
            <div class="flex flex-col">
              <div
                data-component="new-session-context"
                class="flex min-h-11 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-t-2xl border border-b-0 border-v2-border-border-muted bg-v2-background-bg-layer-02/70 px-3 py-1.5 text-[13px] text-v2-text-text-muted"
              >
                <Show when={props.project.empty()}>
                  <PromptProjectAddButton controller={props.project} />
                </Show>
                <Show when={props.project.selected()}>
                  <PromptProjectSelector controller={props.project} placement="bottom" />
                </Show>
                <button
                  type="button"
                  class="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none focus-visible:bg-v2-overlay-simple-overlay-hover"
                  aria-label={language.t("session.new.workspace.chooseServerProject")}
                  title={serverLabel()}
                  onClick={() => props.project.setOpen(true)}
                >
                  <IconV2 name="monitor" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                  <span class="max-w-40 truncate">{serverLabel()}</span>
                </button>
                <Show when={props.project.selected()}>
                  <Show
                    when={props.workspace.bar.visible()}
                    fallback={
                      <PromptGitStatus
                        branch={props.workspace.bar.branch()}
                        noGit={!props.workspace.project.git()}
                        separator={false}
                        onClick={() => props.project.setOpen(true)}
                      />
                    }
                  >
                    <PromptWorkspaceSelector
                      value={props.workspace.selection.value()}
                      projectRoot={props.workspace.project.root()}
                      workspaces={props.workspace.project.workspaces()}
                      branches={props.workspace.project.branches()}
                      branch={props.workspace.bar.branch()}
                      compact
                      onChange={props.workspace.selection.set}
                      onDone={props.input.restoreFocus}
                    />
                  </Show>
                </Show>
              </div>
              <div class="relative -mt-px [&_[data-component=prompt-input-v2]]:rounded-t-lg">
                <PromptInputV2Composer controller={props.input} />
              </div>
            </div>
          </div>
        </div>
        <ProviderTip />
      </div>
    </div>
  )
}

export function NewSessionStatus(props: { mount: Accessor<HTMLElement | null>; visible: Accessor<boolean> }) {
  const language = useLanguage()

  return (
    <Show when={props.mount()} keyed>
      {(mount) => (
        <Portal mount={mount}>
          <Show when={props.visible()}>
            <Tooltip placement="bottom" value={language.t("status.popover.trigger")}>
              <StatusPopoverV2 />
            </Tooltip>
          </Show>
        </Portal>
      )}
    </Show>
  )
}

function ProviderTip() {
  const language = useLanguage()
  const dialog = useDialog()
  const sdk = useSDK()
  const serverSync = useServerSync()
  const providers = useProviders(() => sdk().directory)
  const [persistedState, setPersistedState, , persistedReady] = persisted(
    Persist.global("new-session.provider-tip"),
    createStore({ dismissedAt: 0 }),
  )
  const visible = createMemo(
    () =>
      serverSync().child(sdk().directory)[0].provider_ready &&
      persistedReady() &&
      providers.paid().length === 0 &&
      Date.now() - persistedState.dismissedAt >= providerTipDismissalDuration,
  )
  const [ref, setRef] = createSignal<HTMLDivElement>()
  const presence = createPresence({
    show: visible,
    element: () => ref() ?? null,
  })
  const openProviders = () => {
    void import("@/components/dialog-connect-provider").then(({ DialogConnectProvider }) => {
      void dialog.show(() => <DialogConnectProvider directory={() => sdk().directory} />)
    })
  }

  return (
    <Show when={presence.present()}>
      <div class="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-10">
        <div
          ref={setRef}
          data-component="provider-tip"
          data-visible={visible()}
          class="group/provider-tip pointer-events-auto relative flex h-6 max-w-full items-center transition-[opacity,transform] duration-[250ms] ease-[cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none"
          classList={{ "data-[visible=false]:animate-out fade-out slide-out-to-bottom-4": true }}
        >
          <button
            type="button"
            class="flex h-6 min-w-0 items-center rounded-sm pl-1.5 text-[13px] leading-none tracking-[-0.04px] text-v2-text-text-faint transition-[background-color,color] duration-150 ease-in-out hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-muted focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-text-text-muted focus-visible:outline-none"
            onClick={openProviders}
          >
            <span class="truncate">{language.t("home.providerTip")}</span>
            <span class="flex size-6 shrink-0 items-center justify-center" aria-hidden="true">
              <IconV2 name="chevron-down" size="small" class="-rotate-90" />
            </span>
          </button>
          <TooltipV2
            class="hover-reveal absolute left-full top-0 flex h-6 w-7 items-center justify-end delay-0 duration-0 group-hover/provider-tip:delay-[250ms] group-hover/provider-tip:duration-150 group-hover/provider-tip:opacity-100 focus-within:delay-0 focus-within:duration-0 focus-within:opacity-100"
            placement="top"
            openDelay={1000}
            value={language.t("common.dismiss")}
          >
            <button
              type="button"
              class="flex size-6 items-center justify-center rounded-sm text-v2-icon-icon-muted transition-[background-color,color] duration-150 ease-in-out hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:text-v2-icon-icon-base focus-visible:outline-none"
              aria-label={language.t("common.dismiss")}
              onClick={() => setPersistedState("dismissedAt", Date.now())}
            >
              <IconV2 name="xmark-small" />
            </button>
          </TooltipV2>
        </div>
      </div>
    </Show>
  )
}
