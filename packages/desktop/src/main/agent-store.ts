import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"
import { defaults } from "./agents"
import { t } from "../shared/i18n"
import type { State } from "../shared/types"

export const agentSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  protocol: z.enum(["codex", "claude", "opencode", "pi", "acp"]),
  command: z.string().trim().min(1).max(4096),
  args: z.array(z.string().max(4096)).max(50),
})
const stateSchema = z.object({
  agents: z.array(agentSchema),
  projects: z.array(
    z.object({ directory: z.string(), name: z.string(), icon: z.record(z.string(), z.unknown()).optional() }),
  ),
  selectedAgent: z.string(),
  agentRules: z
    .record(z.string(), z.object({ access: z.enum(["ask", "edits", "auto", "plan", "full"]), fast: z.boolean() }))
    .optional(),
  sessions: z.array(
    z.object({
      id: z.string(),
      agentID: z.string(),
      directory: z.string(),
      title: z.string(),
      model: z.string(),
      variant: z.string().optional(),
      remoteID: z.string().optional(),
      reportedCost: z.number().nonnegative().optional(),
      messages: z.array(
        z.object({
          id: z.string(),
          role: z.enum(["user", "assistant", "tool", "error"]),
          text: z.string(),
          createdAt: z.number().optional(),
          completedAt: z.number().optional(),
          model: z.string().optional(),
          variant: z.string().optional(),
          usage: z
            .object({
              input: z.number().nonnegative().optional(),
              output: z.number().nonnegative().optional(),
              reasoning: z.number().nonnegative().optional(),
              cacheRead: z.number().nonnegative().optional(),
              cacheWrite: z.number().nonnegative().optional(),
              total: z.number().nonnegative().optional(),
              contextUsed: z.number().nonnegative().optional(),
              contextLimit: z.number().nonnegative().optional(),
              model: z.string().optional(),
            })
            .optional(),
          costs: z.record(z.string(), z.number().nonnegative()).optional(),
          tool: z
            .object({
              name: z.string(),
              input: z.record(z.string(), z.unknown()).optional(),
              output: z.string().optional(),
              title: z.string().optional(),
              status: z.enum(["running", "completed", "error"]).optional(),
              error: z.string().optional(),
              metadata: z.record(z.string(), z.unknown()).optional(),
            })
            .optional(),
        }),
      ),
      createdAt: z.number().optional(),
      updatedAt: z.number(),
      status: z.enum(["idle", "running", "error"]),
    }),
  ),
})

export class WorkspaceStore {
  state: State = { agents: structuredClone(defaults), projects: [], sessions: [], selectedAgent: "codex" }
  private writing: Promise<void> = Promise.resolve()
  constructor(private path: string) {}
  async load() {
    const source = await readFile(this.path, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (!source) return
    // Preserve an unreadable store for recovery instead of silently overwriting it.
    const stored = stateSchema.parse(JSON.parse(source))
    this.state = {
      ...stored,
      agents: [
        ...stored.agents,
        ...defaults.filter((agent) => !stored.agents.some((existing) => existing.id === agent.id)),
      ],
      sessions: stored.sessions.map((session) => ({
        ...session,
        status: "idle",
        approvals: [],
        messages:
          session.status === "running"
            ? [...session.messages, { id: crypto.randomUUID(), role: "error", text: t("sessionInterrupted") }]
            : session.messages,
      })),
    }
  }
  save() {
    const source = JSON.stringify(this.state)
    const next = this.writing
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true })
        await writeFile(this.path + ".tmp", source, { mode: 0o600 })
        await rename(this.path + ".tmp", this.path)
      })
    this.writing = next
    return next
  }
}
