import { createMemo, createResource, For, Show } from "solid-js"
import { ButtonV2 } from "@codeink/ui/v2/button-v2"
import { Icon } from "@codeink/ui/v2/icon"
import { MenuV2 } from "@codeink/ui/v2/menu-v2"
import { useLanguage } from "@/context/language"
import { usePlatform, type AgentAccess, type AgentRulesReport } from "@/context/platform"
import { showToast } from "@/utils/toast"

// Shared across composers so every open chat shows the same rules without refetching.
let cached: AgentRulesReport[] | undefined

/** Composer pill for the selected agent's access level and fast mode. */
export function PromptAccessControl(props: { providerID?: string; modelID?: string }) {
  const platform = usePlatform()
  const language = useLanguage()
  const [reports, { mutate, refetch }] = createResource(
    async () => (cached = (await platform.agentWorkspace?.rules()) ?? []),
    { initialValue: cached },
  )
  const loaded = () => (reports.state === "ready" || reports.state === "refreshing" ? reports.latest : undefined)
  const report = createMemo(() => {
    const agentID = props.providerID?.replace(/^local-/, "")
    return loaded()?.find((item) => item.agentID === agentID)
  })
  // The composer's "default" model entry resolves to the agent's own default, which the catalog lists first.
  const model = () => (props.modelID && props.modelID !== "default" ? props.modelID : undefined)
  const supports = (list: string[]) => list.length > 0 && (!model() || list.includes(model()!))
  const options = createMemo(() =>
    (report()?.accessOptions ?? []).filter((access) => access !== "auto" || supports(report()!.autoModels)),
  )
  const fastAvailable = () => !!report() && supports(report()!.fastModels)

  const update = async (next: { access?: AgentAccess; fast?: boolean }) => {
    const current = report()
    if (!current || !platform.agentWorkspace) return
    const rules = { access: next.access ?? current.access, fast: next.fast ?? current.fast }
    mutate((list) => list?.map((item) => (item.agentID === current.agentID ? { ...item, ...rules } : item)))
    await platform.agentWorkspace
      .setRules(current.agentID, rules)
      .then((list) => mutate((cached = list)))
      .catch((cause: unknown) => {
        void refetch()
        showToast({
          title: language.t("common.requestFailed"),
          description: cause instanceof Error ? cause.message : String(cause),
        })
      })
  }

  return (
    <Show when={report()}>
      {(current) => (
        <MenuV2 gutter={6} modal={false} placement="top-start" onOpenChange={(open) => open && void refetch()}>
          <MenuV2.Trigger
            as={ButtonV2}
            variant="ghost-muted"
            size="normal"
            data-action="prompt-access"
            class="max-w-[200px] justify-start ![font-weight:440]"
            classList={{ "!text-v2-state-fg-warning": current().access === "full" }}
            aria-label={language.t("prompt.access.label")}
          >
            <Icon name="shield" size="small" class="shrink-0" />
            <span class="truncate leading-5">{language.t(`prompt.access.${current().access}`)}</span>
            <Show when={current().fast && fastAvailable()}>
              <span class="flex shrink-0 items-center gap-0.5 text-v2-text-text-base">
                <Icon name="bolt" size="small" />
                {language.t("prompt.access.fastBadge")}
              </span>
            </Show>
            <span class="-ms-0.5 -me-1 flex shrink-0">
              <Icon name="chevron-down" />
            </span>
          </MenuV2.Trigger>
          <MenuV2.Portal>
            <MenuV2.Content class="w-[300px]">
              <MenuV2.Group>
                <MenuV2.GroupLabel>{current().name}</MenuV2.GroupLabel>
                <MenuV2.RadioGroup
                  value={current().access}
                  onChange={(value) => {
                    const access = options().find((option) => option === value)
                    if (access) void update({ access })
                  }}
                >
                  <For each={options()}>
                    {(access) => (
                      <MenuV2.RadioItem value={access} class="!h-auto !py-2" closeOnSelect>
                        <span class="flex min-w-0 flex-col gap-0.5">
                          <span classList={{ "text-v2-state-fg-warning": access === "full" }}>
                            {language.t(`prompt.access.${access}`)}
                          </span>
                          <span class="whitespace-normal text-12-regular leading-4 text-v2-text-text-faint">
                            {language.t(`prompt.access.${access}.description`)}
                          </span>
                        </span>
                      </MenuV2.RadioItem>
                    )}
                  </For>
                </MenuV2.RadioGroup>
              </MenuV2.Group>
              <Show when={fastAvailable()}>
                <MenuV2.Separator />
                <MenuV2.CheckboxItem
                  class="!h-auto !py-2"
                  checked={current().fast}
                  onChange={(fast) => void update({ fast })}
                >
                  <span class="flex min-w-0 flex-col gap-0.5">
                    <span>{language.t("prompt.access.fast")}</span>
                    <span class="whitespace-normal text-12-regular leading-4 text-v2-text-text-faint">
                      {language.t("prompt.access.fast.description")}
                    </span>
                  </span>
                </MenuV2.CheckboxItem>
              </Show>
            </MenuV2.Content>
          </MenuV2.Portal>
        </MenuV2>
      )}
    </Show>
  )
}
