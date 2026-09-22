import { createEffect, createResource, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { Icon } from "@opencode-ai/ui/icon"
import { ProviderIcon } from "@opencode-ai/ui/provider-icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { usePlatform, type LocalAgentConnection } from "@/context/platform"
import { useServerSync } from "@/context/server-sync"

export function LocalAgents(props: { selected?: string; onSelect: (id?: string) => void }) {
  const platform = usePlatform()
  const language = useLanguage()
  const dialog = useDialog()
  const sync = useServerSync()
  const [agents] = createResource(() => platform.localAgents?.list() ?? Promise.resolve([]))
  const [form, setForm] = createStore({
    id: "",
    name: "",
    command: "",
    args: "[]",
    protocol: "codex" as LocalAgentConnection["protocol"],
    error: "",
    saving: false,
  })
  createEffect(() => {
    const selected = props.selected?.replace(/^local-/, "")
    const agent = agents()?.find((item) => item.id === selected)
    if (agent) setForm({ ...agent, args: JSON.stringify(agent.args), error: "" })
    if (selected === "_custom")
      setForm({ id: crypto.randomUUID(), name: "", command: "", args: "[]", protocol: "codex", error: "" })
  })
  const save = async (event: SubmitEvent) => {
    event.preventDefault()
    setForm({ saving: true, error: "" })
    try {
      const args: unknown = JSON.parse(form.args)
      if (!Array.isArray(args) || args.some((value) => typeof value !== "string"))
        throw new Error(language.t("agents.invalidArguments"))
      if (!platform.localAgents) throw new Error(language.t("agents.desktopOnly"))
      await platform.localAgents.save({
        id: form.id,
        name: form.name,
        command: form.command,
        protocol: form.protocol,
        args,
      })
      await sync().refreshProviders()
      dialog.close()
    } catch (error) {
      setForm("error", error instanceof Error ? error.message : String(error))
    } finally {
      setForm("saving", false)
    }
  }
  return (
    <div class="flex flex-col gap-5 px-5 py-4 overflow-y-auto min-h-0">
      <p class="text-13-regular text-text-weak">{language.t("agents.description")}</p>
      <Show when={platform.localAgents} fallback={<p>{language.t("agents.desktopOnly")}</p>}>
        <Show
          when={props.selected}
          fallback={
            <div class="flex flex-col gap-1">
              <For each={agents()}>
                {(agent) => (
                  <Button
                    variant="ghost"
                    class="w-full !justify-between !h-auto !py-3"
                    onClick={() => props.onSelect(`local-${agent.id}`)}
                  >
                    <span class="flex items-center gap-3">
                      <ProviderIcon id={`local-${agent.id}`} />
                      {agent.name}
                    </span>
                    <span class="text-12-regular text-text-weak">
                      {agent.executable ? language.t("agents.installed") : agent.command}
                    </span>
                    <Icon name="chevron-right" size="small" />
                  </Button>
                )}
              </For>
              <Button
                variant="ghost"
                icon="plus-small"
                class="!justify-start"
                onClick={() => props.onSelect("_custom")}
              >
                {language.t("agents.add")}
              </Button>
            </div>
          }
        >
          <form class="flex flex-col gap-4" onSubmit={save}>
            <TextField
              label={language.t("agents.name")}
              value={form.name}
              onChange={(name) => setForm("name", name)}
              required
            />
            <label class="flex flex-col gap-2 text-12-medium">
              {language.t("agents.protocol")}
              <select
                class="rounded-md border border-border-base px-3 py-2 bg-surface-base"
                value={form.protocol}
                onChange={(event) => setForm("protocol", event.currentTarget.value as LocalAgentConnection["protocol"])}
              >
                <option value="codex">Codex app-server</option>
                <option value="claude">Claude Code</option>
                <option value="opencode">OpenCode</option>
                <option value="pi">Pi RPC</option>
                <option value="acp">ACP (Agent Client Protocol)</option>
              </select>
            </label>
            <TextField
              label={language.t("agents.executable")}
              value={form.command}
              onChange={(command) => setForm("command", command)}
              required
            />
            <TextField
              label={language.t("agents.arguments")}
              value={form.args}
              onChange={(args) => setForm("args", args)}
              required
            />
            <Show when={!agents()?.find((agent) => agent.id === form.id)?.executable}>
              <p class="text-12-regular text-text-weak">{language.t("agents.missing")}</p>
            </Show>
            <Show when={form.error}>
              <p role="alert" class="text-12-regular text-text-critical-base">
                {form.error}
              </p>
            </Show>
            <Button type="submit" variant="primary" disabled={form.saving}>
              {language.t("common.save")}
            </Button>
          </form>
        </Show>
      </Show>
    </div>
  )
}
