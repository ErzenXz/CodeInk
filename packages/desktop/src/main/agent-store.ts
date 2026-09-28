import { access, copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { constants, readFileSync } from "node:fs"
import { createHash, randomUUID } from "node:crypto"
import { dirname } from "node:path"
import { z } from "zod"
import { defaults } from "./agents"
import { t } from "../shared/i18n"
import { coldSummaries, sessionSummary, sessionSummarySchema } from "./session-summary"
import type { State, Session } from "../shared/types"

export const agentSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  protocol: z.enum(["codex", "claude", "opencode", "pi", "acp", "codeink"]),
  command: z.string().trim().min(1).max(4096),
  args: z.array(z.string().max(4096)).max(50),
})
const messagesSchema = z.array(
  z.object({
    id: z.string(),
    role: z.enum(["user", "assistant", "tool", "error"]),
    text: z.string(),
    attachments: z.array(z.object({ id: z.string().uuid(), filename: z.string(), mime: z.string() })).optional(),
    createdAt: z.number().optional(),
    completedAt: z.number().optional(),
    model: z.string().optional(),
    variant: z.string().optional(),
    mode: z.enum(["build", "plan"]).optional(),
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
    weeklyDelta: z.number().nonnegative().optional(),
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
)

const stateSchema = z.object({
  version: z.literal(2).optional(),
  agents: z.array(agentSchema),
  projects: z.array(
    z.object({ directory: z.string(), name: z.string(), icon: z.record(z.string(), z.unknown()).optional() }),
  ),
  selectedAgent: z.string(),
  agentRules: z
    .record(z.string(), z.object({ access: z.enum(["ask", "edits", "auto", "plan", "full"]), fast: z.boolean() }))
    .optional(),
  sessions: z.array(
    z
      .object({
        id: z.string(),
        agentID: z.string(),
        directory: z.string(),
        title: z.string(),
        model: z.string(),
        variant: z.string().optional(),
        remoteID: z.string().optional(),
        reportedCost: z.number().nonnegative().optional(),
        handoff: z
          .object({ fromSessionID: z.string(), fromAgentID: z.string(), context: z.string().max(16_000) })
          .optional(),
        messages: messagesSchema.optional(),
        history: z
          .object({
            hash: z.string().regex(/^[a-f0-9]{64}$/),
            bytes: z.number().int().nonnegative(),
            summary: sessionSummarySchema,
          })
          .optional(),
        createdAt: z.number().optional(),
        updatedAt: z.number(),
        status: z.enum(["idle", "running", "error"]),
      })
      .refine((session) => (session.messages !== undefined) !== (session.history !== undefined), {
        message: t("historyCorrupt"),
      }),
  ),
})

type History = NonNullable<z.infer<typeof stateSchema>["sessions"][number]["history"]>
type Entry = { history?: History; messages?: Session["messages"]; cleanHash?: string }
const historyHash = (source: string) => createHash("sha256").update(source).digest("hex")

export class WorkspaceStore {
  state: State = { agents: structuredClone(defaults), projects: [], sessions: [], selectedAgent: "codex" }
  private writing: Promise<void> = Promise.resolve()
  private scheduled?: Promise<void>
  private entries = new WeakMap<Session, Entry>()
  private loaded = new Map<Session, Entry>()
  private committed = new Set<string>()
  private migrating = false
  constructor(private path: string) {}

  async load() {
    const source = await readFile(this.path, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (!source) return
    // Preserve an unreadable store for recovery instead of silently overwriting it.
    const stored = stateSchema.parse(JSON.parse(source))
    await Promise.all(
      stored.sessions.flatMap((session) => (session.history ? [access(this.historyPath(session.history.hash))] : [])),
    )
    this.migrating = stored.version !== 2
    this.committed = new Set(stored.sessions.flatMap((session) => (session.history ? [session.history.hash] : [])))
    this.state = {
      agents: [
        ...stored.agents,
        ...defaults.filter((agent) => !stored.agents.some((existing) => existing.id === agent.id)),
      ],
      projects: stored.projects,
      selectedAgent: stored.selectedAgent,
      agentRules: stored.agentRules,
      sessions: stored.sessions.map((value) => {
        const { messages, history, ...metadata } = value
        const session: Session = { ...metadata, status: "idle", approvals: [], messages: [] }
        this.bind(session, { history, messages })
        if (value.status === "running")
          session.messages.push({ id: randomUUID(), role: "error", text: t("sessionInterrupted") })
        return session
      }),
    }
    // Migrate once, keeping the original file intact as an explicit recovery copy.
    if (this.migrating || stored.sessions.some((session) => session.status === "running")) await this.save()
  }

  save() {
    if (this.scheduled) return this.scheduled
    this.scheduled = Promise.resolve().then(() => {
      this.scheduled = undefined
      // Capture before yielding: subsequent mutations belong to the next save.
      const snapshots = this.state.sessions.map((session) => {
        const entry = this.entries.get(session) ?? this.bind(session, { messages: session.messages })
        const source = entry.messages ? JSON.stringify(entry.messages) : undefined
        const history =
          source !== undefined
            ? { hash: historyHash(source), bytes: Buffer.byteLength(source), summary: sessionSummary(session) }
            : entry.history!
        // Enumerating values/spreading the Session would hydrate its lazy messages getter.
        const metadata = Object.fromEntries(
          Object.keys(session)
            .filter((key) => key !== "messages")
            .map((key) => [key, session[key as keyof Session]]),
        )
        return { session, entry, source, history, metadata }
      })
      const source = JSON.stringify({
        ...this.state,
        version: 2,
        sessions: snapshots.map((snapshot) => ({
          ...snapshot.metadata,
          history: snapshot.history,
        })),
      })
      const created = new Set<string>()
      const temporaryFiles = new Set<string>()
      const next = this.writing
        .catch(() => {})
        .then(async () => {
          await mkdir(dirname(this.path), { recursive: true })
          await mkdir(this.path + ".history", { recursive: true, mode: 0o700 })
          if (this.migrating) {
            await copyFile(this.path, this.path + ".legacy", constants.COPYFILE_EXCL).catch(
              (error: NodeJS.ErrnoException) => {
                if (error.code !== "EEXIST") throw error
              },
            )
          }
          // Content-addressed files make the index rename the commit point. A failed
          // save or crash cannot replace a transcript referenced by the previous index.
          const written = await Promise.allSettled(
            snapshots.map(async (snapshot) => {
              if (snapshot.source === undefined) return
              const path = this.historyPath(snapshot.history.hash)
              if (
                await access(path).then(
                  () => true,
                  () => false,
                )
              )
                return
              const temporary = path + "." + randomUUID() + ".tmp"
              temporaryFiles.add(temporary)
              await writeFile(temporary, snapshot.source, { mode: 0o600 })
              await rename(temporary, path)
              temporaryFiles.delete(temporary)
              created.add(snapshot.history.hash)
            }),
          )
          const errors = written.filter((result) => result.status === "rejected").map((result) => result.reason)
          if (errors.length > 0) throw new AggregateError(errors, t("historySaveFailed"))
          await writeFile(this.path + ".tmp", source, { mode: 0o600 })
          await rename(this.path + ".tmp", this.path)
          this.migrating = false
          const previous = this.committed
          this.committed = new Set(snapshots.map((snapshot) => snapshot.history.hash))
          snapshots.forEach((snapshot) => {
            snapshot.entry.history = snapshot.history
            if (snapshot.source !== undefined) snapshot.entry.cleanHash = snapshot.history.hash
          })
          this.trim()
          // Loaded snapshots always carry their source, including queued saves, so
          // they can recreate a hash if an earlier commit retired it.
          await Promise.all(
            [...previous]
              .filter((hash) => !this.committed.has(hash))
              .map((hash) => unlink(this.historyPath(hash)).catch(() => {})),
          )
        })
        .catch(async (error: unknown) => {
          // Failed saves must not accumulate full copies of a streaming transcript.
          // Queued saves retain their source and can recreate an uncommitted hash.
          await Promise.all(
            [
              ...temporaryFiles,
              ...[...created].filter((hash) => !this.committed.has(hash)).map((hash) => this.historyPath(hash)),
            ].map((path) => unlink(path).catch(() => {})),
          )
          throw error
        })
      this.writing = next
      return next
    })
    return this.scheduled
  }

  private historyPath(hash: string) {
    return this.path + ".history/" + hash + ".json"
  }

  private bind(session: Session, entry: Entry) {
    this.entries.set(session, entry)
    if (entry.messages) this.loaded.set(session, entry)
    if (!entry.messages && entry.history) coldSummaries.set(session, entry.history.summary)
    Object.defineProperty(session, "messages", {
      enumerable: true,
      configurable: true,
      get: () => {
        const loading = !entry.messages
        if (!entry.messages) {
          const source = readFileSync(this.historyPath(entry.history!.hash), "utf8")
          if (historyHash(source) !== entry.history!.hash) throw new Error(t("historyCorrupt"))
          entry.messages = messagesSchema.parse(JSON.parse(source))
          // Validation can reorder object fields. Compare future edits against the
          // normalized in-memory representation, rather than the file's key order.
          entry.cleanHash = historyHash(JSON.stringify(entry.messages))
          coldSummaries.delete(session)
        }
        this.loaded.delete(session)
        this.loaded.set(session, entry)
        if (loading) this.trim(session)
        return entry.messages
      },
      set: (messages: Session["messages"]) => {
        entry.messages = messages
        entry.cleanHash = undefined
        coldSummaries.delete(session)
        this.loaded.delete(session)
        this.loaded.set(session, entry)
      },
    })
    return entry
  }

  private trim(keep?: Session) {
    if (!keep) {
      const present = new Set(this.state.sessions)
      this.loaded.forEach((_, session) => {
        if (!present.has(session)) this.loaded.delete(session)
      })
    }
    const idle = [...this.loaded].filter(([session]) => session.status !== "running" && session.approvals.length === 0)
    let count = idle.length
    let bytes = idle.reduce((total, [, entry]) => total + (entry.history?.bytes ?? 0), 0)
    for (const [session, entry] of idle) {
      if (count <= 4 && bytes <= 16 * 1024 * 1024) break
      if (session === keep || !entry.history || !entry.messages) continue
      // Messages are mutable; never discard edits made during an asynchronous save.
      if (historyHash(JSON.stringify(entry.messages)) !== entry.cleanHash) continue
      coldSummaries.set(session, entry.history.summary)
      entry.messages = undefined
      this.loaded.delete(session)
      count--
      bytes -= entry.history.bytes
    }
  }
}
