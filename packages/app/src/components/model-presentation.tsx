import { Show } from "solid-js"

type Model = { name: string; options?: Record<string, unknown>; provider: { id: string } }

export function compareModels(a: Model, b: Model) {
  const first = a.options?.codeinkOrder
  const second = b.options?.codeinkOrder
  if (a.provider.id === b.provider.id && typeof first === "number" && typeof second === "number") return first - second
  return a.name.localeCompare(b.name, undefined, { numeric: true })
}

export function ModelLabel(props: { model: Model }) {
  const tag = () => (typeof props.model.options?.codeinkTag === "string" ? props.model.options.codeinkTag : undefined)
  return (
    <span class="flex min-w-0 flex-1 items-center gap-2">
      <span class="min-w-0 truncate">{props.model.name}</span>
      <Show when={tag()}>
        <span class="shrink-0 rounded border border-current/15 px-1 text-[10px] font-medium leading-4 opacity-65">
          {tag()}
        </span>
      </Show>
    </span>
  )
}
