import { type Component, createEffect, createMemo, createResource, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ButtonV2 } from "@codeink/ui/v2/button-v2"
import { SelectV2 } from "@codeink/ui/v2/select-v2"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { showToast } from "@/utils/toast"
import "./settings-v2.css"

export const SettingsInstructionsV2: Component = () => {
  const platform = usePlatform()
  const language = useLanguage()
  const [files, { mutate }] = createResource(() => platform.agentWorkspace?.instructions() ?? Promise.resolve([]))
  const [state, setState] = createStore({ selected: undefined as string | undefined, draft: "", saving: false })

  // Installed agents first, so the default selection is one the user can actually run.
  const ordered = createMemo(() =>
    [...((files.state === "ready" || files.state === "refreshing" ? files.latest : undefined) ?? [])].sort(
      (a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name),
    ),
  )
  const current = createMemo(() => ordered().find((file) => file.agentID === state.selected) ?? ordered()[0])
  createEffect(() => setState("draft", current()?.content ?? ""))
  const dirty = () => state.draft !== (current()?.content ?? "")

  const save = async () => {
    const file = current()
    if (!file || !platform.agentWorkspace) return
    setState("saving", true)
    const content = state.draft
    await platform.agentWorkspace
      .saveInstructions(file.agentID, content)
      .then(() => {
        mutate((list) =>
          list?.map((item) => (item.agentID === file.agentID ? { ...item, content, exists: true } : item)),
        )
        showToast({ title: language.t("settings.instructions.saved") })
      })
      .catch((cause: unknown) =>
        showToast({
          title: language.t("common.requestFailed"),
          description: cause instanceof Error ? cause.message : String(cause),
        }),
      )
      .finally(() => setState("saving", false))
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <div class="flex items-center justify-between gap-4">
          <h2 class="settings-v2-tab-title">{language.t("settings.instructions.title")}</h2>
          <Show when={current()}>
            <ButtonV2 variant="contrast" size="small" disabled={!dirty() || state.saving} onClick={() => void save()}>
              {state.saving ? language.t("common.saving") : language.t("common.save")}
            </ButtonV2>
          </Show>
        </div>
      </div>
      <div class="settings-v2-tab-body">
        <p class="-mt-4 text-[13px] leading-5 text-v2-text-text-muted">
          {language.t("settings.instructions.description")}
        </p>
        <Show when={platform.agentWorkspace} fallback={<p class="text-[13px]">{language.t("hub.desktopOnly")}</p>}>
          <Show when={current()}>
            {(file) => (
              <div class="flex min-w-0 flex-col gap-3">
                <div class="flex min-w-0 items-center gap-3">
                  <SelectV2
                    appearance="base"
                    class="max-w-56"
                    options={ordered()}
                    current={file()}
                    value={(item) => item.agentID}
                    label={(item) => item.name}
                    aria-label={language.t("settings.instructions.title")}
                    onSelect={(item) => {
                      if (!item || item.agentID === file().agentID) return
                      if (dirty() && !window.confirm(language.t("settings.instructions.discard"))) return
                      setState("selected", item.agentID)
                    }}
                  />
                  <Show
                    when={dirty()}
                    fallback={
                      <Show when={!file().exists}>
                        <span class="text-[11px] text-v2-text-text-faint">
                          {language.t("settings.instructions.new")}
                        </span>
                      </Show>
                    }
                  >
                    <span class="text-[11px] text-v2-state-fg-warning">
                      {language.t("settings.instructions.unsaved")}
                    </span>
                  </Show>
                </div>
                <span class="min-w-0 truncate font-mono text-[11px] text-v2-text-text-faint" title={file().path}>
                  {file().path}
                </span>
                <textarea
                  class="block min-h-[300px] w-full resize-y rounded-lg border border-v2-border-border-muted bg-v2-background-bg-base px-4 py-3 font-mono text-[12.5px] leading-5 text-v2-text-text-base outline-none focus:border-v2-border-border-focus placeholder:text-v2-text-text-faint"
                  spellcheck={false}
                  placeholder={language.t("settings.instructions.placeholder")}
                  aria-label={file().name}
                  value={state.draft}
                  onInput={(event) => setState("draft", event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (!(event.metaKey || event.ctrlKey) || event.key !== "s") return
                    event.preventDefault()
                    if (dirty()) void save()
                  }}
                />
              </div>
            )}
          </Show>
        </Show>
      </div>
    </>
  )
}
