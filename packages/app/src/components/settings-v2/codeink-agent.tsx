import { createResource, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ButtonV2 } from "@codeink/ui/v2/button-v2"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import "./settings-v2.css"

const gateways = [
  { id: "vercel", name: "Vercel AI Gateway" },
  { id: "openrouter", name: "OpenRouter" },
] as const

export function SettingsCodeInkAgentV2() {
  const platform = usePlatform()
  const language = useLanguage()
  const sync = useServerSync()
  const [status, { mutate }] = createResource(
    () => platform.agentWorkspace?.gatewayStatus() ?? Promise.resolve({ vercel: false, openrouter: false }),
  )
  const [form, setForm] = createStore({ vercel: "", openrouter: "", saving: "" })

  const save = async (provider: "vercel" | "openrouter", remove = false) => {
    if (!platform.agentWorkspace || form.saving) return
    setForm("saving", provider)
    await platform.agentWorkspace
      .setGatewayKey(provider, remove ? "" : form[provider])
      .then(async (next) => {
        mutate(next)
        setForm(provider, "")
        await sync().refreshProviders()
        showToast({ title: language.t(remove ? "settings.codeinkAgent.removed" : "settings.codeinkAgent.saved") })
      })
      .catch((cause: unknown) =>
        showToast({
          title: language.t("common.requestFailed"),
          description: cause instanceof Error ? cause.message : String(cause),
        }),
      )
      .finally(() => setForm("saving", ""))
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.codeinkAgent.title")}</h2>
      </div>
      <div class="settings-v2-tab-body">
        <p class="-mt-4 text-[13px] leading-5 text-v2-text-text-muted">
          {language.t("settings.codeinkAgent.description")}
        </p>
        <Show when={platform.agentWorkspace} fallback={<p class="text-[13px]">{language.t("hub.desktopOnly")}</p>}>
          <For each={gateways}>
            {(gateway) => (
              <section class="flex flex-col gap-3 border-b border-v2-border-border-muted pb-5 last:border-b-0">
                <div class="flex items-center justify-between gap-4">
                  <h3 class="text-[13px] font-semibold text-v2-text-text-base">{gateway.name}</h3>
                  <span class="text-[11px] text-v2-text-text-faint">
                    {language.t(
                      status.latest?.[gateway.id]
                        ? "settings.codeinkAgent.connected"
                        : "settings.codeinkAgent.disconnected",
                    )}
                  </span>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <input
                    type="password"
                    autocomplete="off"
                    class="min-w-44 flex-1 rounded-md border border-v2-border-border-muted bg-transparent px-3 py-2 text-[13px] text-v2-text-text-base outline-none focus:border-v2-border-border-strong"
                    placeholder={language.t("settings.codeinkAgent.keyPlaceholder")}
                    aria-label={language.t("settings.codeinkAgent.keyFor", { provider: gateway.name })}
                    value={form[gateway.id]}
                    onInput={(event) => setForm(gateway.id, event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void save(gateway.id)
                    }}
                  />
                  <ButtonV2
                    variant="contrast"
                    size="small"
                    disabled={!form[gateway.id].trim() || !!form.saving}
                    onClick={() => void save(gateway.id)}
                  >
                    {language.t("settings.codeinkAgent.save")}
                  </ButtonV2>
                  <Show when={status.latest?.[gateway.id]}>
                    <ButtonV2
                      variant="outline"
                      size="small"
                      disabled={!!form.saving}
                      onClick={() => void save(gateway.id, true)}
                    >
                      {language.t("settings.codeinkAgent.remove")}
                    </ButtonV2>
                  </Show>
                </div>
              </section>
            )}
          </For>
          <p class="text-[12px] leading-5 text-v2-text-text-faint">{language.t("settings.codeinkAgent.note")}</p>
        </Show>
      </div>
    </>
  )
}
