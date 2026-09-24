import { randomUUID } from "node:crypto"
import { t } from "../shared/i18n"
import type { AgentEvent, AgentRules, Answer, Message, SendInput, Session } from "../shared/types"
import type { Adapter } from "./adapters/types"
import { connectAgent, resolveExecutable } from "./agents"
import { WorkspaceStore } from "./agent-store"

export class Sessions {
  private adapters = new Map<string, Adapter>()
  private connections = new Map<string, symbol>()
  private dirty = new Set<Session>()
  private messageIndexes = new WeakMap<Session, Map<string, Message>>()
  private currentUsers = new WeakMap<Session, Message>()
  private flushTimer?: ReturnType<typeof setTimeout>
  /** Sessions whose agent must relaunch before the next turn so changed rules take effect. */
  private stale = new Set<string>()
  constructor(
    private store: WorkspaceStore,
    private env: NodeJS.ProcessEnv,
    private publish: (session: Session) => void,
    private features: (agentID: string) => { fast: string[]; auto: string[]; default?: string } = () => ({
      fast: [],
      auto: [],
    }),
  ) {}

  rules(agentID: string): AgentRules {
    return this.store.state.agentRules?.[agentID] ?? { access: "ask", fast: false }
  }

  /** Rules as they apply to one session: fast mode only where its model supports it. */
  private effectiveRules(session: Session): AgentRules {
    const rules = this.rules(session.agentID)
    const features = this.features(session.agentID)
    const model = !session.model || session.model === "default" ? features.default : session.model
    return { ...rules, fast: rules.fast && !!model && features.fast.includes(model) }
  }

  async setRules(agentID: string, rules: AgentRules) {
    this.store.state.agentRules = { ...this.store.state.agentRules, [agentID]: rules }
    await this.store.save()
    this.store.state.sessions
      .filter((session) => session.agentID === agentID)
      .forEach((session) => {
        const adapter = this.adapters.get(session.id)
        if (!adapter || adapter.setRules?.(this.effectiveRules(session))) return
        // A running turn finishes under the old rules; the agent relaunches (resuming) before the next one.
        if (session.status === "running") return this.stale.add(session.id)
        this.connections.delete(session.id)
        adapter.dispose()
        this.adapters.delete(session.id)
      })
  }

  async send(input: SendInput) {
    const agent = this.store.state.agents.find((value) => value.id === input.agentID)
    if (!agent) throw new Error(t("unknownAgent"))
    const existing = input.sessionID ? this.get(input.sessionID) : undefined
    if (existing && this.retry(existing, input)) return structuredClone(existing)
    if (existing?.status === "running") throw new Error(t("busy"))
    if (existing && (existing.agentID !== input.agentID || existing.directory !== input.directory))
      throw new Error(t("modelLocked"))
    const executable = await resolveExecutable(agent.command, this.env)
    if (!executable) throw new Error(t("missingAgent"))
    const session: Session = existing ?? {
      id: randomUUID(),
      agentID: agent.id,
      directory: input.directory,
      model: input.model,
      title: input.text.trim().slice(0, 72),
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "idle",
      approvals: [],
    }
    // Recheck after executable resolution, which yields to concurrent IPC requests.
    if (this.retry(session, input)) return structuredClone(session)
    if (session.status === "running") throw new Error(t("busy"))
    if (this.stale.delete(session.id)) {
      this.connections.delete(session.id)
      this.adapters.get(session.id)?.dispose()
      this.adapters.delete(session.id)
    }
    if (session.model !== input.model || session.variant !== input.variant) {
      // Keep native conversation history while reconnecting with the new selection.
      const adapter = this.adapters.get(session.id)
      if (adapter?.configure) adapter.configure(input.model, input.variant)
      else {
        this.connections.delete(session.id)
        adapter?.dispose()
        this.adapters.delete(session.id)
      }
      session.messages
        .filter((message) => message.role === "user" && message.model === undefined)
        .forEach((message) => {
          message.model = session.model
          message.variant = session.variant
        })
    }
    session.model = input.model
    session.variant = input.variant
    if (!existing) this.store.state.sessions.unshift(session)
    const message: Message = {
      id: input.messageID ?? `msg_${Date.now().toString(16)}${randomUUID().replaceAll("-", "")}`,
      role: "user",
      text: input.text,
      attachments: input.attachments?.map(({ id, filename, mime }) => ({ id, filename, mime })),
      model: session.model,
      variant: session.variant,
      mode: this.rules(agent.id).access === "plan" ? "plan" : "build",
      createdAt: Date.now(),
    }
    session.messages.push(message)
    this.messageIndexes.set(session, new Map())
    this.currentUsers.set(session, message)
    session.status = "running"
    session.updatedAt = Date.now()
    await this.store.save()
    this.publish(session)
    const token = this.connections.get(session.id) ?? Symbol(session.id)
    this.connections.set(session.id, token)
    const emit = (event: AgentEvent) => {
      if (this.connections.get(session.id) === token) this.receive(session, event)
    }
    const adapter =
      this.adapters.get(session.id) ??
      connectAgent({
        agent,
        executable,
        env: this.env,
        directory: session.directory,
        model: session.model,
        variant: session.variant,
        remoteID: session.remoteID,
        rules: () => this.effectiveRules(session),
        emit,
      })
    this.adapters.set(session.id, adapter)
    // IPC returns the admitted session immediately; process events stream separately.
    void adapter.prompt(input.handoffContext ? `${input.handoffContext}\n\nCurrent request:\n${input.text}` : input.text, input.attachments)
      .catch((error: Error) => emit({ type: "error", text: error.message }))
    return structuredClone(session)
  }

  private receive(session: Session, event: AgentEvent) {
    if (!this.store.state.sessions.includes(session)) return
    const user = this.currentUsers.get(session) ?? session.messages.findLast((message) => message.role === "user")
    if (event.type === "session") session.remoteID = event.id
    if (event.type === "usage") {
      if (user) {
        user.usage = {
          ...user.usage,
          ...Object.fromEntries(Object.entries(event.usage).filter(([, value]) => value !== undefined)),
        }
        if (event.cost !== undefined) user.costs = { ...user.costs, [event.id]: event.cost }
      }
      if (event.sessionCost !== undefined) session.reportedCost = event.sessionCost
    }
    if (event.type === "text" || event.type === "tool") {
      const id = `${user?.id}:${event.id}`
      const index = this.messageIndexes.get(session) ?? new Map<string, Message>()
      this.messageIndexes.set(session, index)
      const message = index.get(id)
      if (!message) {
        const created: Message = {
          id,
          createdAt: Date.now(),
          role: event.type === "tool" ? "tool" : "assistant",
          text: event.text,
          ...(event.type === "tool" ? { tool: event.tool } : {}),
        }
        session.messages.push(created)
        index.set(id, created)
      } else {
        message.text = event.type === "tool" || event.replace ? event.text : message.text + event.text
        if (event.type === "tool" && event.tool) message.tool = { ...message.tool, ...event.tool }
      }
    }
    if (event.type === "approval" && !session.approvals.some((item) => item.id === event.approval.id))
      session.approvals.push(event.approval)
    if (event.type === "approval-resolved") session.approvals = session.approvals.filter((item) => item.id !== event.id)
    if (event.type === "error") {
      session.status = "error"
      session.approvals = []
      session.messages.push({ id: randomUUID(), role: "error", text: event.text })
      this.adapters.get(session.id)?.dispose()
      this.adapters.delete(session.id)
      this.connections.delete(session.id)
    }
    if (event.type === "done") {
      if (session.status === "running") session.status = "idle"
      session.approvals = session.approvals.filter((approval) => approval.questions)
      session.messages.slice(session.messages.findLastIndex((item) => item.role === "user") + 1).forEach((message) => {
        message.completedAt = Date.now()
        if (message.tool?.status === "running") message.tool.status = "completed"
      })
    }
    session.updatedAt = Date.now()
    // Coalesce all active agents into one disk snapshot per 50 ms window.
    this.dirty.add(session)
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      const dirty = [...this.dirty]
      this.dirty.clear()
      dirty.forEach(this.publish)
      void this.store.save().catch((error: Error) => {
        dirty.forEach((session) => {
          session.status = "error"
          session.messages.push({ id: randomUUID(), role: "error", text: error.message })
          this.publish(session)
        })
      })
    }, 50)
  }

  private retry(session: Session, input: SendInput) {
    if (!input.messageID) return false
    const message = session.messages.find((message) => message.id === input.messageID)
    if (!message) return false
    if (
      message.role !== "user" ||
      message.text !== input.text ||
      JSON.stringify(message.attachments ?? []) !==
        JSON.stringify(input.attachments?.map(({ id, filename, mime }) => ({ id, filename, mime })) ?? []) ||
      (message.model ?? session.model) !== input.model ||
      message.variant !== input.variant ||
      session.agentID !== input.agentID ||
      session.directory !== input.directory
    )
      throw new Error(t("messageConflict"))
    return true
  }

  get(id: string) {
    const session = this.store.state.sessions.find((value) => value.id === id)
    if (!session) throw new Error(t("unknownSession"))
    return session
  }
  async stop(id: string) {
    const session = this.get(id)
    const adapter = this.adapters.get(id)
    this.connections.delete(id)
    // Dispose after interruption to guarantee no background turn remains alive.
    if (adapter) {
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        adapter.stop().catch(() => {}),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 2000)
        }),
      ])
      clearTimeout(timer)
    }
    adapter?.dispose()
    this.adapters.delete(id)
    session.status = "idle"
    session.approvals = []
    this.publish(session)
    await this.store.save()
  }
  async answer(id: string, requestID: string, answer: Answer) {
    const session = this.get(id)
    const adapter = this.adapters.get(id)
    if (!adapter || !session.approvals.some((item) => item.id === requestID)) throw new Error(t("noApproval"))
    await adapter.answer(requestID, answer)
    session.approvals = session.approvals.filter((item) => item.id !== requestID)
    this.publish(session)
    await this.store.save()
  }
  async archive(id: string) {
    await this.stop(id)
    this.store.state.sessions = this.store.state.sessions.filter((value) => value.id !== id)
    await this.store.save()
  }
  isAgentBusy(id: string) {
    return this.store.state.sessions.some((session) => session.agentID === id && session.status === "running")
  }
  resetAgent(id: string) {
    this.store.state.sessions
      .filter((session) => session.agentID === id)
      .forEach((session) => {
        this.connections.delete(session.id)
        this.adapters.get(session.id)?.dispose()
        this.adapters.delete(session.id)
      })
  }
  async dispose() {
    this.connections.clear()
    this.adapters.forEach((adapter) => adapter.dispose())
    this.adapters.clear()
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.dirty.clear()
    await this.store.save()
  }
}
