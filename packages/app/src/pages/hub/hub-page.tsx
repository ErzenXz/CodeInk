import { Show, type JSX, type ParentProps } from "solid-js"
import { ProviderIcon } from "@codeink/ui/provider-icon"

export function HubPage(props: ParentProps<{ title: string; description: string; actions?: JSX.Element }>) {
  return (
    <div class="relative size-full overflow-y-auto bg-v2-background-bg-base shadow-[inset_0.5px_0_0_var(--v2-border-border-muted)]">
      <div class="mx-auto flex w-full max-w-[880px] flex-col px-10 pb-16 pt-12 max-md:px-5">
        <header class="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div class="flex min-w-0 flex-col gap-1.5">
            <h1 class="text-[22px] font-semibold leading-7 tracking-[-0.3px] text-v2-text-text-base">{props.title}</h1>
            <p class="text-[13px] leading-5 text-v2-text-text-muted">{props.description}</p>
          </div>
          <Show when={props.actions}>
            <div class="flex shrink-0 items-center gap-2">{props.actions}</div>
          </Show>
        </header>
        {props.children}
      </div>
    </div>
  )
}

/** Rounded white card holding a list of rows, matching the settings lists. */
export function HubCard(props: ParentProps<{ class?: string }>) {
  return (
    <div
      class={`flex flex-col overflow-hidden rounded-xl bg-v2-background-bg-base shadow-[var(--v2-glass-shadow-raised)] ${props.class ?? ""}`}
    >
      {props.children}
    </div>
  )
}

export function HubEmpty(props: ParentProps) {
  return (
    <div class="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-v2-border-border-base px-6 text-center text-[13px] leading-5 text-v2-text-text-muted">
      {props.children}
    </div>
  )
}

export function AgentIcon(props: { agentID: string; class?: string }) {
  return <ProviderIcon id={`local-${props.agentID}`} class={props.class ?? "size-4 shrink-0"} />
}
