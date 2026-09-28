import type { Component, JSX } from "solid-js"
import { createMemo, splitProps, Show } from "solid-js"
import sprite from "./provider-icons/sprite.svg"
import agents from "./agent-icons.svg"
import codeinkIcon from "../assets/brand/codeink-icon.png"
import { iconNames, type IconName } from "./provider-icons/types"

export type ProviderIconProps = JSX.SVGElementTags["svg"] & {
  id: string
}

const agentIDs = new Set([
  "pi",
  "opencode",
  "gemini",
  "github-copilot-cli",
  "cursor",
  "cline",
  "kimi",
  "qwen-code",
  "goose",
  "mistral-vibe",
  "auggie",
  "factory-droid",
  "kilo",
  "devin",
  "amp-acp",
  "qoder",
  "codebuddy-code",
  "cortex-code",
  "junie",
  "deepagents",
  "minimax-code",
  "grok-build",
  "stakpak",
  "nova",
])

export const ProviderIcon: Component<ProviderIconProps> = (props) => {
  const [local, rest] = splitProps(props, ["id", "class", "classList"])

  const resolved = createMemo(() => {
    const id = local.id.replace(/^local-/, "")
    if ((local.id.startsWith("local-") || id === "opencode") && agentIDs.has(id)) return `${agents}#${id}`
    const name = ({ codex: "openai", claude: "anthropic" } as Record<string, string>)[id] ?? local.id
    return `${sprite}#${iconNames.includes(name as IconName) ? name : "synthetic"}`
  })
  return (
    <svg
      data-component="provider-icon"
      {...rest}
      classList={{
        ...local.classList,
        [local.class ?? ""]: !!local.class,
      }}
    >
      <Show when={local.id === "local-codeink"} fallback={<use href={resolved()} />}>
        <image href={codeinkIcon} width="100%" height="100%" />
      </Show>
    </svg>
  )
}
