import type { Component, JSX } from "solid-js"
import { createMemo, splitProps } from "solid-js"
import sprite from "./provider-icons/sprite.svg"
import agents from "./agent-icons.svg"
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
    if (local.id.startsWith("local-") && agentIDs.has(id)) return `${agents}#${id}`
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
      <use href={resolved()} />
    </svg>
  )
}
