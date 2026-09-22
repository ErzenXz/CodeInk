import type { Agent, AgentEvent, Answer } from "../../shared/types"

export type AdapterOptions = {
  agent: Agent
  executable: string
  directory: string
  remoteID?: string
  model: string
  variant?: string
  env: NodeJS.ProcessEnv
  emit: (event: AgentEvent) => void
}
export type Adapter = {
  configure?(model: string, variant?: string): void
  prompt(text: string): Promise<void>
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
