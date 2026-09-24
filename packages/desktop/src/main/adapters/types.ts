import type { Agent, AgentEvent, AgentRules, Answer, PromptAttachment } from "../../shared/types"

export type AdapterOptions = {
  agent: Agent
  executable: string
  directory: string
  remoteID?: string
  model: string
  variant?: string
  env: NodeJS.ProcessEnv
  /** Current access and speed rules; read at launch and, where the agent allows it, on every turn. */
  rules: () => AgentRules
  emit: (event: AgentEvent) => void
}
export type Adapter = {
  configure?(model: string, variant?: string): void
  /** Applies changed rules to the running agent; returns false when it must restart to take effect. */
  setRules?(rules: AgentRules): boolean
  prompt(text: string, attachments?: PromptAttachment[]): Promise<void>
  stop(): Promise<void>
  answer(id: string, answer: Answer): Promise<void>
  dispose(): void
}
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
export function string(value: unknown) {
  return typeof value === "string" ? value : ""
}
export function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
export function detail(value: unknown) {
  return typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "")
}
