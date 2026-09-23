import { Collapsible } from "@kobalte/core/collapsible"
import type { JSX } from "solid-js"
import { TextShimmerV2 } from "@codeink/ui/v2/text-shimmer-v2"
import { ChevronIcon } from "./basic-tool-v2"
import "./basic-tool-v2.css"

/** Collapsed summary row for a run of tool calls; expanding reveals each call's own row. */
export function ToolGroupV2(props: {
  summary: string
  partIDs: string
  /** "work" is the finished-turn fold: a divider rule and an unindented step list. */
  variant?: "tools" | "work"
  active?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: JSX.Element
}) {
  return (
    <Collapsible
      data-component="basic-tool-v2"
      data-variant="group"
      data-group={props.variant ?? "tools"}
      data-timeline-part-ids={props.partIDs}
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <Collapsible.Trigger as="div" role="button" data-slot="basic-tool-v2-trigger">
        <div data-slot="basic-tool-v2-labels">
          <span data-slot="basic-tool-v2-title">
            <TextShimmerV2 text={props.summary} active={!!props.active} />
          </span>
          <span data-slot="basic-tool-v2-chevron-wrap">
            <ChevronIcon />
          </span>
        </div>
      </Collapsible.Trigger>
      <Collapsible.Content data-slot="basic-tool-v2-content">
        <div data-slot="tool-group-v2-list">{props.children}</div>
      </Collapsible.Content>
    </Collapsible>
  )
}
