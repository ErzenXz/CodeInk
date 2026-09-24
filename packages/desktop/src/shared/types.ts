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
  attachments?: Attachment[]
  createdAt?: number
  completedAt?: number
  model?: string
  variant?: string
  mode?: "build" | "plan"
  tool?: ToolInfo
  usage?: Usage
  costs?: Record<string, number>
}
export type Attachment = { id: string; filename: string; mime: string }
export type PromptAttachment = Attachment & { path: string }
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
/** CodeInk's shared vocabulary for how much an agent may do without asking; adapters map it to native modes. */
export type AgentAccess = "ask" | "edits" | "auto" | "plan" | "full"
export type AgentRules = { access: AgentAccess; fast: boolean }
export type AgentRulesReport = AgentRules & {
  agentID: string
  name: string
  /** Access levels this agent's CLI supports, in menu order. */
  accessOptions: AgentAccess[]
  /** Model ids that support fast mode, and those that support automatic review. */
  fastModels: string[]
  autoModels: string[]
}
export type State = {
  agents: Agent[]
  projects: Project[]
  sessions: Session[]
  selectedAgent: string
  agentRules?: Record<string, AgentRules>
}
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
  handoffContext?: string
  attachments?: PromptAttachment[]
}

export type AgentExtension = {
  id: string
  agentID: string
  kind: "skill" | "plugin" | "mcp"
  name: string
  description?: string
  source?: string
  version?: string
  path?: string
  enabled?: boolean
  /** Whether CodeInk can flip `enabled` through the agent's own API or CLI. */
  toggleable: boolean
  status?: string
  tools?: number
}
export type AgentExtensionReport = { agentID: string; name: string; extensions: AgentExtension[]; error?: string }
export type AgentLimitWindow = {
  id: string
  kind: "session" | "weekly" | "other"
  usedPercent: number
  resetsAt?: number
  /** Model or surface a scoped limit applies to, as the agent names it. */
  label?: string
  warning?: boolean
}
export type AgentUsageTotals = {
  sessions: number
  messages: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost?: number
  lastUsed?: number
}
export type AgentUsageReport = {
  agentID: string
  name: string
  installed: boolean
  plan?: string
  windows: AgentLimitWindow[]
  /** "live" comes from the agent's API; "cache" from the agent's own local usage cache. */
  source?: "live" | "cache"
  fetchedAt?: number
  error?: string
  totals: AgentUsageTotals
}
export type AgentInstructions = {
  agentID: string
  name: string
  installed: boolean
  path: string
  content: string
  exists: boolean
}
