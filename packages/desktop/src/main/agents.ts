import { access } from "node:fs/promises"
import { constants } from "node:fs"
import { delimiter, isAbsolute, join } from "node:path"
import type { Agent, AgentAccess, AgentStatus } from "../shared/types"
import { codex } from "./adapters/codex"
import { claude } from "./adapters/claude"
import { opencode } from "./adapters/opencode"
import { pi } from "./adapters/pi"
import { acp } from "./adapters/acp"
import type { AdapterOptions } from "./adapters/types"

export const defaults: Agent[] = [
  { id: "codex", name: "Codex", protocol: "codex", command: "codex", args: [] },
  { id: "claude", name: "Claude Code", protocol: "claude", command: "claude", args: [] },
  { id: "opencode", name: "OpenCode", protocol: "opencode", command: "opencode", args: [] },
  { id: "pi", name: "Pi", protocol: "pi", command: "pi", args: [] },
  // Launch commands from the official ACP registry (see AGENT-SOURCES.md).
  // Only independently installed executables are resolved; never npx/uvx downloads.
  ...(
    [
      ["gemini", "Gemini CLI", "gemini", ["--acp"]],
      ["github-copilot-cli", "GitHub Copilot", "copilot", ["--acp"]],
      ["cursor", "Cursor", "cursor-agent", ["acp"]],
      ["cline", "Cline", "cline", ["--acp"]],
      ["kimi", "Kimi CLI", "kimi", ["acp"]],
      ["qwen-code", "Qwen Code", "qwen", ["--acp"]],
      ["goose", "Goose", "goose", ["acp"]],
      ["mistral-vibe", "Mistral Vibe", "vibe-acp", []],
      ["auggie", "Auggie", "auggie", ["--acp"]],
      ["factory-droid", "Factory Droid", "droid", ["exec", "--output-format", "acp-daemon"]],
      ["kilo", "Kilo", "kilo", ["acp"]],
      ["devin", "Devin", "devin", ["acp"]],
      ["amp-acp", "Amp", "amp-acp", []],
      ["qoder", "Qoder", "qoder", ["--acp"]],
      ["codebuddy-code", "CodeBuddy", "codebuddy", ["--acp"]],
      ["cortex-code", "Cortex Code", "cortex", ["acp", "serve"]],
      ["junie", "Junie", "junie", ["--acp=true"]],
      ["deepagents", "DeepAgents", "deepagents-acp", []],
      ["minimax-code", "MiniMax Code", "mcode", ["acp"]],
      ["grok-build", "Grok Build", "grok", ["agent", "stdio"]],
      ["stakpak", "Stakpak", "stakpak", ["acp"]],
      ["nova", "Nova", "nova", ["acp"]],
    ] satisfies [string, string, string, string[]][]
  ).map(([id, name, command, args]) => ({ id, name, command, args, protocol: "acp" as const })),
]

/** Access levels each native protocol can express; other agents keep their own defaults. */
export const accessOptions: Partial<Record<Agent["protocol"], AgentAccess[]>> = {
  claude: ["ask", "edits", "auto", "plan", "full"],
  codex: ["ask", "auto", "plan", "full"],
  opencode: ["ask", "plan"],
}

export async function resolveExecutable(command: string, env: NodeJS.ProcessEnv) {
  const extensions = process.platform === "win32" ? ["", ".exe", ".com", ".cmd", ".bat"] : [""]
  // Never search the project's working directory for an agent binary.
  const candidates = isAbsolute(command)
    ? [command]
    : (env.PATH ?? env.Path ?? "")
        .split(delimiter)
        .filter(isAbsolute)
        .flatMap((directory) => extensions.map((ext) => join(directory, command + ext)))
  for (const candidate of candidates) {
    if (
      await access(candidate, constants.X_OK).then(
        () => true,
        () => false,
      )
    )
      return candidate
  }
}

export async function detectAgents(agents: Agent[], env: NodeJS.ProcessEnv): Promise<AgentStatus[]> {
  return Promise.all(
    agents.map(async (agent) => ({ ...agent, executable: await resolveExecutable(agent.command, env) })),
  )
}

export function connectAgent(options: AdapterOptions) {
  return { codex, claude, opencode, pi, acp }[options.agent.protocol](options)
}
