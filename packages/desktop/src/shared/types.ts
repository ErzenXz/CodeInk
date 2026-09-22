export type Protocol = "codex" | "claude" | "opencode" | "pi" | "acp"
export type ToolInfo = {
  name: string
  input?: Record<string, unknown>
  output?: string
  title?: string
  status?: "running" | "completed" | "error"
  error?: string
  metadata?: Record<string, unknown>
}
export type Agent = { id: string; name: string; protocol: Protocol; command: string; args: string[] }
export type AgentStatus = Agent & { executable?: string }
export type Usage = {
  input?: number
  output?: number
  reasoning?: number
  cacheRead?: number
  cacheWrite?: number
  total?: number
  contextUsed?: number
  contextLimit?: number
  model?: string
}
export type Message = {
  id: string
  role: "user" | "assistant" | "tool" | "error"
  text: string
  createdAt?: number
  completedAt?: number
  model?: string
  variant?: string
  tool?: ToolInfo
  usage?: Usage
  costs?: Record<string, number>
}
export type Question = { id: string; text: string; options?: string[]; multiple?: boolean }
export type Approval = { id: string; title: string; detail: string; questions?: Question[] }
export type Session = {
  id: string
  agentID: string
  directory: string
  title: string
  model: string
  variant?: string
  remoteID?: string
  reportedCost?: number
  messages: Message[]
  createdAt?: number
  updatedAt: number
  status: "idle" | "running" | "error"
  approvals: Approval[]
}
export type Project = { directory: string; name: string; icon?: Record<string, unknown> }
export type State = { agents: Agent[]; projects: Project[]; sessions: Session[]; selectedAgent: string }
export type FileEntry = { name: string; path: string; directory: boolean }
export type AgentEvent =
  | { type: "text"; id: string; text: string; replace?: boolean }
  | { type: "tool"; id: string; text: string; tool?: ToolInfo }
  | { type: "error"; text: string }
  | { type: "session"; id: string }
  | { type: "approval"; approval: Approval }
  | { type: "approval-resolved"; id: string }
  | { type: "usage"; id: string; usage: Usage; cost?: number; sessionCost?: number }
  | { type: "done" }
export type Answer = { allow: boolean; answers?: Record<string, string[]> }
export type SendInput = {
  sessionID?: string
  messageID?: string
  agentID: string
  directory: string
  model: string
  variant?: string
  text: string
}
