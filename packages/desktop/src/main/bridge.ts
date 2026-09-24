import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import { homedir } from "node:os"
import { basename, join, resolve } from "node:path"
import { readFile, realpath, stat, unlink } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { Agent, Attachment, Session, Usage, AgentRules, AgentRulesReport } from "../shared/types"
import type { Message, Part } from "@codeink/sdk/v2/client"
type LegacySession = import("@codeink/sdk/v2/client").Session
import { WorkspaceStore, agentSchema } from "./agent-store"
import { Sessions } from "./sessions"
import { detectAgents, accessOptions } from "./agents"
import { listFiles, previewFile } from "./files"
import { array, object, string } from "./adapters/types"
import { t } from "../shared/i18n"
import { createTerminals } from "./terminals"
import { ModelCatalog } from "./model-catalog"
import { savedTool, toolInfo } from "./adapters/tool-info"
import { attachmentPath, stageAttachment } from "./attachments"
import { handoffContext } from "./handoff"

const projectID = (directory: string) => createHash("sha256").update(directory).digest("hex").slice(0, 40)
const signature = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24)
const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
const toolCache = new WeakMap<object, { text: string; info: ReturnType<typeof savedTool> }>()
const partIDs = new WeakMap<Session["messages"][number], { index: number; id: string; value: string }>()
function sessionCost(session: Session) {
  if (session.reportedCost !== undefined) return session.reportedCost
  let cost = 0
  let seen = false
  for (const message of session.messages) {
    if (message.role !== "user") continue
    if (!message.costs) return undefined
    seen = true
    for (const amount of Object.values(message.costs)) cost += amount
  }
  return seen ? cost : undefined
}

export function legacySession(session: Session): LegacySession {
  const cost = sessionCost(session)
  return {
    id: session.id,
    slug: session.id,
    projectID: projectID(session.directory),
    directory: session.directory,
    title: session.title,
    version: "0.1.0",
    agent: "build",
    model: { providerID: `local-${session.agentID}`, id: session.model || "default", variant: session.variant },
    time: { created: session.createdAt ?? session.updatedAt, updated: session.updatedAt },
    cost: cost ?? 0,
    ...{ codeinkCostKnown: cost !== undefined },
    tokens,
  }
}

// The upstream renderer consumes its original wire format. Protocol translation
// stays here so its session layout, timeline, composer and panels remain intact.
export function legacyMessages(session: Session, attachmentURL = (id: string) => `attachment:${id}`, startIndex = 0, endIndex = session.messages.length): { info: Message; parts: Part[] }[] {
  const result: { info: Message; parts: Part[] }[] = []
  let parent = ""
  let model = session.model
  let mode: "build" | "plan" = "build"
  let usage: Usage | undefined
  let cost: number | undefined
  let current: { info: Message; parts: Part[] } | undefined
  session.messages.slice(startIndex, endIndex).forEach((message, offset) => {
    const index = startIndex + offset
    const createdAt = message.createdAt ?? session.createdAt ?? session.updatedAt
    const completedAt = message.completedAt ?? createdAt
    const cachedPart = partIDs.get(message)
    const partID =
      cachedPart?.index === index && cachedPart.id === message.id
        ? cachedPart.value
        : `prt_${index.toString().padStart(12, "0")}${createHash("sha256").update(message.id).digest("hex").slice(0, 12)}`
    if (cachedPart?.index !== index || cachedPart.id !== message.id)
      partIDs.set(message, { index, id: message.id, value: partID })
    if (message.role === "user") {
      if (current?.info.role === "assistant") {
        current.info.time.completed ??= createdAt
        current.info.finish = "stop"
      }
      parent = message.id
      usage = message.usage
      model = usage?.model ?? message.model ?? session.model
      mode = message.mode ?? "build"
      cost = message.costs ? Object.values(message.costs).reduce((a, b) => a + b, 0) : undefined
      current = undefined
      result.push({
        info: {
          id: message.id,
          role: "user",
          sessionID: session.id,
          time: { created: createdAt },
          agent: "build",
          model: { providerID: `local-${session.agentID}`, modelID: model || "default", variant: message.variant },
        },
        parts: [
          { id: partID, messageID: message.id, sessionID: session.id, type: "text", text: message.text },
          ...(message.attachments ?? []).map((attachment) => ({
            id: `prt_${attachment.id.replaceAll("-", "")}`,
            messageID: message.id,
            sessionID: session.id,
            type: "file" as const,
            mime: attachment.mime,
            filename: attachment.filename,
            url: attachmentURL(attachment.id),
          })),
        ],
      })
      return
    }
    if (!parent) return
    if (!current) {
      current = {
        info: {
          id: `${parent}a`,
          role: "assistant",
          sessionID: session.id,
          parentID: parent,
          time: {
            created: createdAt,
            ...(message.completedAt !== undefined || session.status !== "running" ? { completed: completedAt } : {}),
          },
          modelID: model || "default",
          providerID: `local-${session.agentID}`,
          mode,
          agent: "build",
          path: { cwd: session.directory, root: session.directory },
          cost: cost ?? 0,
          ...{ codeinkUsage: usage ?? {}, codeinkCostKnown: cost !== undefined },
          tokens: {
            input: usage?.input ?? 0,
            output: usage?.output ?? 0,
            reasoning: usage?.reasoning ?? 0,
            cache: { read: usage?.cacheRead ?? 0, write: usage?.cacheWrite ?? 0 },
          },
          ...(message.completedAt !== undefined || session.status !== "running" ? { finish: "stop" } : {}),
        },
        parts: [],
      }
      result.push(current)
    }
    if (current.info.role === "assistant" && message.completedAt !== undefined)
      current.info.time.completed = Math.max(current.info.time.completed ?? 0, message.completedAt)
    if (message.role === "error" && current.info.role === "assistant") {
      current.info.error = { name: "UnknownError", data: { message: message.text } }
      return
    }
    const base = { id: partID, messageID: current.info.id, sessionID: session.id }
    if (message.role === "tool") {
      const cached = toolCache.get(message)
      const raw = message.tool ?? (cached?.text === message.text ? cached.info : savedTool(message.text))
      const tool =
        raw.input && !raw.input.filePath && (raw.input.file_path || raw.input.path)
          ? { ...raw, input: toolInfo(raw.name, raw.input).input }
          : raw
      if (!message.tool && cached?.text !== message.text) toolCache.set(message, { text: message.text, info: tool })
      const status = tool.status ?? "completed"
      current.parts.push({
        ...base,
        type: "tool",
        callID: message.id,
        tool: tool.name,
        state:
          status === "running"
            ? {
                status,
                input: tool.input ?? {},
                title: tool.title || tool.name,
                metadata: { ...tool.metadata, output: tool.output ?? "" },
                time: { start: createdAt },
              }
            : status === "error"
              ? {
                  status,
                  input: tool.input ?? {},
                  error: tool.error || tool.output || t("failed"),
                  metadata: tool.metadata ?? {},
                  time: { start: createdAt, end: completedAt },
                }
              : {
                  status,
                  input: tool.input ?? {},
                  output: tool.output ?? message.text,
                  title: tool.title || tool.name,
                  metadata: tool.metadata ?? {},
                  time: { start: createdAt, end: completedAt },
                },
      })
      return
    }
    current.parts.push({ ...base, type: "text", text: message.text })
  })
  if (current?.info.role === "assistant" && session.messages[endIndex]?.role === "user") {
    current.info.time.completed ??= session.messages[endIndex].createdAt ?? session.createdAt ?? session.updatedAt
    current.info.finish = "stop"
  }
  return result
}

function pageStart(session: Session, endIndex: number, limit: number) {
  let count = 0
  let hasReply = false
  for (let index = endIndex - 1; index >= 0; index--) {
    if (session.messages[index].role !== "user") {
      hasReply = true
      continue
    }
    count += hasReply ? 2 : 1
    if (count >= limit) return index
    hasReply = false
  }
  return 0
}

function currentSession(session: Session) {
  const legacy = legacySession(session)
  return {
    ...legacy,
    location: { directory: session.directory },
    model: { providerID: `local-${session.agentID}`, id: session.model || "default", variant: session.variant },
  }
}

export async function startBridge(
  hostname: string,
  port: number,
  password: string,
  directory: string,
  env: NodeJS.ProcessEnv,
) {
  const store = new WorkspaceStore(join(directory, "agents.json"))
  await store.load()
  const attachmentOwners = new Map<string, Attachment>(
    store.state.sessions.flatMap((session) => session.messages.flatMap((message) => message.attachments ?? [])).map((item) => [item.id, item]),
  )
  const streams = new Set<{ response: ServerResponse; directory?: string; global: boolean }>()
  const snapshots = new Map<string, Map<string, string>>()
  const projected = new WeakMap<Session, { length: number; userIndex: number; userID?: string; updatedAt: number; status: Session["status"] }>()
  let attachmentPort = 0
  const attachmentURL = (id: string) => `http://${hostname}:${attachmentPort}/attachment/${id}`
  const emit = (directory: string, type: string, properties: unknown) => {
    const payload = { type, properties }
    for (const stream of streams) {
      if (stream.directory && stream.directory !== directory) continue
      stream.response.write(`data: ${JSON.stringify(stream.global ? { directory, payload } : payload)}\n\n`)
    }
  }
  const permission = (session: Session, approval: Session["approvals"][number]) => ({
    id: `${session.id}:${approval.id}`,
    sessionID: session.id,
    permission: "external_agent",
    patterns: [approval.title],
    always: [],
    metadata: { description: approval.detail },
  })
  const question = (session: Session, approval: Session["approvals"][number]) => ({
    id: `${session.id}:${approval.id}`,
    sessionID: session.id,
    questions: approval.questions?.map((item) => ({
      question: item.text,
      header: item.text.slice(0, 25),
      multiple: item.multiple,
      custom: true,
      options: (item.options ?? []).map((label) => ({ label, description: "" })),
    })),
  })
  const publish = (session: Session) => {
    const previous = snapshots.get(session.id) ?? new Map<string, string>()
    const last = projected.get(session)
    const addedUser = session.messages
      .slice(last?.length ?? 0)
      .findLastIndex((message) => message.role === "user")
    const userIndex =
      !last || session.messages.length < last.length
        ? session.messages.findLastIndex((message) => message.role === "user")
        : addedUser < 0 ? last.userIndex : last.length + addedUser
    const userID = session.messages[userIndex]?.id
    const reset = !last || last.userID !== userID || session.messages.length < last.length
    const next = reset ? new Map<string, string>() : previous
    const changed = (key: string, value: unknown, type: string, properties: unknown) => {
      const serialized = signature(value)
      const before = previous.get(key)
      next.set(key, serialized)
      if (before !== serialized) emit(session.directory, type, properties)
    }
    const info = legacySession(session)
    changed("session", info, "session.updated", { info })
    if (session.status === "running" || (last && (last.length !== session.messages.length || last.updatedAt !== session.updatedAt || last.status !== session.status))) {
      for (const message of legacyMessages(session, attachmentURL, Math.max(0, userIndex))) {
        changed(message.info.id, message.info, "message.updated", { info: message.info })
        message.parts.forEach((part) => changed(part.id, part, "message.part.updated", { part }))
      }
    }
    const approvals = new Set<string>()
    for (const approval of session.approvals) {
      const value = approval.questions ? question(session, approval) : permission(session, approval)
      const key = `approval:${value.id}`
      approvals.add(key)
      changed(key, value, approval.questions ? "question.asked" : "permission.asked", value)
    }
    for (const key of next.keys()) if (key.startsWith("approval:") && !approvals.has(key)) next.delete(key)
    const status = { type: session.status === "running" ? "busy" : "idle" }
    const previousStatus = previous.get("status")
    changed("status", status, "session.status", { sessionID: session.id, status })
    if (status.type === "idle" && previousStatus !== signature(status))
      emit(session.directory, "session.idle", { sessionID: session.id })
    snapshots.set(session.id, next)
    projected.set(session, { length: session.messages.length, userIndex, userID, updatedAt: session.updatedAt, status: session.status })
  }
  // The catalog is created below; the callback only runs once a session needs model features.
  const sessions = new Sessions(store, env, publish, (agentID) => catalog.features(agentID))
  const listAgents = () => detectAgents(store.state.agents, env)
  const saveAgent = async (input: Agent) => {
    const agent = agentSchema.parse(input)
    if (sessions.isAgentBusy(agent.id)) throw new Error(t("pending"))
    const old = store.state.agents.find((item) => item.id === agent.id)
    if (old && old.protocol !== agent.protocol && store.state.sessions.some((item) => item.agentID === agent.id))
      throw new Error(t("modelLocked"))
    sessions.resetAgent(agent.id)
    catalog.invalidate(agent.id)
    store.state.agents = [...store.state.agents.filter((item) => item.id !== agent.id), agent]
    await store.save()
    emit("global", "global.disposed", {})
    return listAgents()
  }
  let catalogTimer: ReturnType<typeof setTimeout> | undefined
  const catalog = new ModelCatalog(env, () => {
    if (catalogTimer) return
    catalogTimer = setTimeout(() => {
      catalogTimer = undefined
      emit("global", "integration.connection.updated", {})
    }, 80)
  })
  const providers = async (cwd: string) => catalog.list(await listAgents(), cwd)
  const agentRules = async (): Promise<AgentRulesReport[]> =>
    (await listAgents()).flatMap((agent) => {
      const options = accessOptions[agent.protocol]
      if (!agent.executable || !options) return []
      const features = catalog.features(agent.id)
      return [
        {
          agentID: agent.id,
          name: agent.name,
          ...sessions.rules(agent.id),
          accessOptions: options,
          fastModels: features.fast,
          autoModels: features.auto,
        },
      ]
    })
  const setAgentRules = async (agentID: string, rules: AgentRules) => {
    const agent = store.state.agents.find((item) => item.id === agentID)
    if (!agent || !accessOptions[agent.protocol]?.includes(rules.access)) throw new Error(t("unsupportedFeature"))
    await sessions.setRules(agentID, rules)
    return agentRules()
  }
  const project = async (path: string) => {
    const root = await realpath(path)
    if (!(await stat(root)).isDirectory()) throw new Error(t("invalidProject"))
    if (!store.state.projects.some((item) => item.directory === root)) {
      store.state.projects.push({ directory: root, name: basename(root) })
      await store.save()
    }
    const stored = store.state.projects.find((item) => item.directory === root)!
    return {
      id: projectID(root),
      worktree: root,
      name: stored.name,
      icon: stored.icon,
      time: { created: 0, updated: 0 },
      sandboxes: [],
    }
  }
  const git = async (cwd: string, args: string[]) =>
    (
      await promisify(execFile)("git", args, {
        cwd,
        encoding: "utf8",
        timeout: 10000,
        maxBuffer: 5 * 1024 * 1024,
        windowsHide: true,
      })
    ).stdout
  const readBody = async (request: IncomingMessage) => {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      size += chunk.length
      if (size > 32 * 1024 * 1024) throw new Error(t("requestTooLarge"))
      chunks.push(Buffer.from(chunk))
    }
    return chunks.length ? object(JSON.parse(Buffer.concat(chunks).toString("utf8"))) : {}
  }
  const server = createServer((request, response) => {
    void (async () => {
      const origin = request.headers.origin
      if (origin && (origin === "codeink://renderer" || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)))
        response.setHeader("Access-Control-Allow-Origin", origin)
      response.setHeader("Access-Control-Expose-Headers", "x-next-cursor")
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization,Content-Type,x-opencode-directory,x-opencode-workspace,x-opencode-ticket",
      )
      response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,PUT,OPTIONS")
      if (request.method === "OPTIONS") {
        response.writeHead(204).end()
        return
      }
      const attachment = /^\/attachment\/([a-f0-9-]{36})$/.exec(request.url ?? "")
      if (attachment && request.method === "GET") {
        const owner = attachmentOwners.get(attachment[1])
        if (!owner) return response.writeHead(404).end()
        const data = await readFile(attachmentPath(directory, owner.id))
        response.writeHead(200, {
          "Content-Type": owner.mime,
          "Content-Length": data.length,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, max-age=3600",
        })
        response.end(data)
        return
      }
      const expected = Buffer.from(`Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`)
      const actual = Buffer.from(request.headers.authorization ?? "")
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        response.writeHead(401).end()
        return
      }
      const url = new URL(request.url!, `http://${hostname}:${port}`)
      const path = url.pathname
      const cwd = resolve(
        url.searchParams.get("directory") ||
          decodeURIComponent(string(request.headers["x-opencode-directory"])) ||
          homedir(),
      )
      const method = request.method ?? "GET"
      const body = ["POST", "PATCH", "PUT"].includes(method) ? await readBody(request) : {}
      const json = (value: unknown, status = 200) => {
        response.writeHead(status, { "Content-Type": "application/json" })
        response.end(JSON.stringify(value))
      }
      if (path === "/global/event" || path === "/event") {
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        })
        response.flushHeaders()
        const stream = { response, global: path === "/global/event", directory: path === "/event" ? cwd : undefined }
        streams.add(stream)
        const payload = { type: "server.connected", properties: {} }
        response.write(`data: ${JSON.stringify(stream.global ? { directory: "global", payload } : payload)}\n\n`)
        const timer = setInterval(() => response.write(": heartbeat\n\n"), 15000)
        response.on("close", () => {
          streams.delete(stream)
          clearInterval(timer)
        })
        return
      }
      if (path === "/global/health" || path === "/api/health") return json({ healthy: true, version: "0.1.0" })
      if (path === "/api/session" && method === "GET")
        return json({ data: store.state.sessions.map(currentSession), cursor: {} })
      if (path === "/api/reference" && method === "GET") return json({ data: [] })
      if (path === "/pty" || path.startsWith("/pty/")) return json(await terminals.route(path, method, cwd, body))
      if (path === "/provider") {
        if (url.searchParams.get("refresh") === "true") catalog.invalidate()
        return json(await providers(cwd))
      }
      if (path === "/provider/auth") return json({})
      if (path.startsWith("/auth/") || path.includes("/oauth/"))
        return json({ name: "Unsupported", data: { message: t("externalSignIn") } }, 409)
      if (path === "/global/config" || path === "/config")
        return json({ model: `local-${store.state.selectedAgent}/default`, share: "disabled", autoupdate: false })
      if (path === "/config/providers") {
        const data = await providers(cwd)
        return json({ providers: data.all, default: data.default })
      }
      if (path === "/path")
        return json({ home: homedir(), state: directory, config: directory, worktree: cwd, directory: cwd })
      if (path === "/project" || path === "/experimental/project")
        return json(await Promise.all(store.state.projects.map((item) => project(item.directory))))
      if (path === "/project/current") return json(await project(cwd))
      const projectRoute = /^\/project\/([^/]+)$/.exec(path)
      if (projectRoute && method === "PATCH") {
        const item = store.state.projects.find((item) => projectID(item.directory) === projectRoute[1])
        if (!item) throw new Error(t("invalidProject"))
        if (typeof body.name === "string") item.name = body.name
        if (body.icon) item.icon = object(body.icon)
        await store.save()
        const info = { ...(await project(item.directory)), name: item.name, icon: item.icon }
        emit("global", "project.updated", info)
        return json(info)
      }
      if (path === "/agent")
        return json([
          {
            name: "build",
            description: t("agentDescription"),
            mode: "primary",
            native: true,
            permission: [],
            options: {},
          },
        ])
      if (
        [
          "/command",
          "/skill",
          "/lsp",
          "/formatter",
          "/experimental/resource",
          "/experimental/tool",
          "/experimental/tool/ids",
          "/experimental/worktree",
          "/experimental/workspace",
          "/pty",
        ].includes(path) &&
        method === "GET"
      )
        return json([])
      if (path === "/mcp" || path === "/experimental/workspace/status") return json({})
      if (path === "/experimental/capabilities") return json({ backgroundSubagents: false })
      if (path === "/experimental/console") return json({ consoleManagedProviders: [], switchableOrgCount: 0 })
      if (path === "/log") return json(true)
      if (path === "/instance/dispose" || path === "/global/dispose") {
        catalog.invalidate()
        emit("global", "global.disposed", {})
        return json(true)
      }
      if (path === "/vcs")
        return json({
          branch: await git(cwd, ["branch", "--show-current"]).then(
            (value) => value.trim(),
            () => undefined,
          ),
        })
      if (path === "/file")
        return json(
          (await listFiles(cwd, url.searchParams.get("path") || "")).map((item) => ({
            name: item.name,
            path: item.path,
            absolute: join(cwd, item.path),
            type: item.directory ? "directory" : "file",
            ignored: false,
          })),
        )
      if (path === "/file/content")
        return json({ type: "text", content: await previewFile(cwd, url.searchParams.get("path") || "") })
      if (path === "/find/file") {
        const query = (url.searchParams.get("query") || "").toLowerCase()
        const files = await git(cwd, ["ls-files", "--cached", "--others", "--exclude-standard"]).then(
          (value) => value.split("\n").filter(Boolean),
          async () => (await listFiles(cwd, "")).map((item) => item.path),
        )
        return json(
          [...new Set(files)]
            .filter((file) => file.toLowerCase().includes(query))
            .slice(0, Number(url.searchParams.get("limit") || 100)),
        )
      }
      if (path === "/file/status" || path === "/vcs/status" || path === "/vcs/diff" || path === "/vcs/diff/raw") {
        const hasHead = await git(cwd, ["rev-parse", "--verify", "HEAD"]).then(
          () => true,
          () => false,
        )
        const args = ["diff", "--no-ext-diff", "--no-textconv", ...(hasHead ? ["HEAD"] : [])]
        if (path.endsWith("/raw")) return json(await git(cwd, [...args, "--"]).catch(() => ""))
        const stats = await git(cwd, [...args, "--numstat", "--"]).catch(() => "")
        const files = await Promise.all(
          stats
            .trim()
            .split("\n")
            .filter(Boolean)
            .map(async (line) => {
              const [added, removed, ...name] = line.split("\t")
              const file = name.join("\t")
              return {
                file,
                path: file,
                additions: Number(added) || 0,
                deletions: Number(removed) || 0,
                added: Number(added) || 0,
                removed: Number(removed) || 0,
                status: "modified",
                ...(path === "/vcs/diff" ? { patch: await git(cwd, [...args, "--", file]) } : {}),
              }
            }),
        )
        return json(files)
      }
      if ((path === "/session" || path === "/experimental/session") && method === "GET") {
        const limit = url.searchParams.get("limit")
        if (limit !== null && (!Number.isSafeInteger(Number(limit)) || Number(limit) < 1))
          return json({ error: "Invalid session limit" }, 400)
        return json(
          store.state.sessions
            .filter(
              (item) =>
                (!url.searchParams.has("directory") || item.directory === cwd) &&
                (!url.searchParams.get("search") || item.title.includes(url.searchParams.get("search")!)),
            )
            .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
            .slice(0, limit === null ? undefined : Number(limit))
            .map(legacySession),
        )
      }
      if (path === "/session" && method === "POST") {
        await project(cwd)
        const requestedModel = object(body.model)
        const providerID = string(requestedModel.providerID)
        const requestedAgent = providerID.startsWith("local-") ? providerID.slice(6) : ""
        const knownAgent = store.state.agents.some((agent) => agent.id === requestedAgent)
        const session: Session = {
          id: `ses_${randomUUID().replaceAll("-", "")}`,
          agentID: knownAgent ? requestedAgent : store.state.selectedAgent,
          directory: cwd,
          model: knownAgent && string(requestedModel.id) !== "default" ? string(requestedModel.id) : "",
          variant: knownAgent ? string(requestedModel.variant) || undefined : undefined,
          title: t("newSession"),
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: "idle",
          approvals: [],
        }
        store.state.sessions.unshift(session)
        await store.save()
        emit(cwd, "session.created", { info: legacySession(session) })
        return json(legacySession(session))
      }
      if (path === "/session/status")
        return json(
          Object.fromEntries(
            store.state.sessions.filter((item) => item.status === "running").map((item) => [item.id, { type: "busy" }]),
          ),
        )
      if (path === "/permission" || path === "/question")
        return json(
          store.state.sessions
            .filter((item) => item.directory === cwd)
            .flatMap((session) =>
              session.approvals
                .filter((approval) => (path === "/question" ? !!approval.questions : !approval.questions))
                .map((approval) =>
                  path === "/question" ? question(session, approval) : permission(session, approval),
                ),
            ),
        )
      const legacyPermission = /^\/session\/([^/]+)\/permissions\/([^/]+)$/.exec(path)
      if (legacyPermission && method === "POST") {
        const session = sessions.get(decodeURIComponent(legacyPermission[1]))
        const requestID = decodeURIComponent(legacyPermission[2])
        if (!requestID.startsWith(`${session.id}:`)) throw new Error(t("noApproval"))
        await sessions.answer(session.id, requestID.slice(session.id.length + 1), {
          allow: body.response === "once" || body.response === "always",
        })
        emit(session.directory, "permission.replied", { sessionID: session.id, requestID, reply: body.response })
        return json(true)
      }
      const reply = /^\/(permission|question)\/([^/]+)\/(reply|reject)$/.exec(path)
      if (reply) {
        const id = decodeURIComponent(reply[2])
        const separator = id.indexOf(":")
        const session = sessions.get(id.slice(0, separator))
        const requestID = id.slice(separator + 1)
        const approval = session.approvals.find((item) => item.id === requestID)
        await sessions.answer(session.id, requestID, {
          allow: reply[3] !== "reject" && body.reply !== "reject",
          answers: approval?.questions
            ? Object.fromEntries(
                approval.questions.map((question, index) => [
                  question.id,
                  array(array(body.answers)[index]).map(string),
                ]),
              )
            : undefined,
        })
        emit(
          session.directory,
          reply[1] === "question"
            ? reply[3] === "reject"
              ? "question.rejected"
              : "question.replied"
            : "permission.replied",
          { sessionID: session.id, requestID: id, reply: body.reply, answers: body.answers },
        )
        return json(true)
      }
      const route = /^\/session\/([^/]+)(?:\/(.*))?$/.exec(path)
      if (route) {
        const session = sessions.get(decodeURIComponent(route[1]))
        const action = route[2]
        if (!action && method === "GET") return json(legacySession(session))
        if (!action && method === "PATCH") {
          session.title = string(body.title) || session.title
          await store.save()
          publish(session)
          return json(legacySession(session))
        }
        if (!action && method === "DELETE") {
          const attachments = session.messages.flatMap((message) => message.attachments ?? [])
          await sessions.archive(session.id)
          snapshots.delete(session.id)
          await Promise.all(attachments.map(async (attachment) => {
            attachmentOwners.delete(attachment.id)
            await unlink(attachmentPath(directory, attachment.id)).catch(() => {})
          }))
          emit(session.directory, "session.deleted", { info: legacySession(session) })
          return json(true)
        }
        if (action === "abort") {
          await sessions.stop(session.id)
          return json(true)
        }
        if (["children", "todo", "diff"].includes(action!)) return json([])
        if (action === "message" && method === "GET") {
          if (!url.searchParams.has("limit") && !url.searchParams.has("before"))
            return json(legacyMessages(session, attachmentURL))
          const limit = Number(url.searchParams.get("limit") ?? 20)
          const before = url.searchParams.get("before")
          const endIndex = before === null ? session.messages.length : Number(before)
          if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(endIndex) || endIndex < 0 || endIndex > session.messages.length ||
              (before !== null && endIndex < session.messages.length && session.messages[endIndex]?.role !== "user"))
            return json({ error: "Invalid conversation page" }, 400)
          const startIndex = pageStart(session, endIndex, Math.min(limit, 200))
          if (startIndex > 0) response.setHeader("x-next-cursor", String(startIndex))
          return json(legacyMessages(session, attachmentURL, startIndex, endIndex))
        }
        if (action?.startsWith("message/") && method === "GET") {
          const id = decodeURIComponent(action.slice(8))
          const exact = session.messages.findIndex((item) => item.role === "user" && item.id === id)
          const startIndex = exact >= 0 ? exact : session.messages.findIndex((item) => item.role === "user" && `${item.id}a` === id)
          if (startIndex < 0) return json({ error: "Message not found" }, 404)
          const next = session.messages.findIndex((item, index) => index > startIndex && item.role === "user")
          const endIndex = next < 0 ? session.messages.length : next
          const item = legacyMessages(session, attachmentURL, startIndex, endIndex).find((item) => item.info.id === id)
          return item ? json(item) : json({ error: "Message not found" }, 404)
        }
        if (action === "prompt_async" || (action === "message" && method === "POST")) {
          const model = object(body.model)
          const agentID = string(model.providerID).replace(/^local-/, "") || session.agentID
          const modelID = string(model.modelID) === "default" ? "" : string(model.modelID)
          if (!session.messages.length) {
            session.agentID = agentID
            session.model = modelID
          }
          const parts = array(body.parts).map(object)
          const staged = await Promise.allSettled(
            parts.filter((part) => part.type === "file" && !part.source).map((part) => stageAttachment(directory, part, string(body.messageID))),
          )
          const failure = staged.find((result) => result.status === "rejected")
          if (failure) {
            await Promise.all(staged
              .filter((result) => result.status === "fulfilled")
              .filter((result) => !attachmentOwners.has(result.value.id))
              .map((result) => unlink(result.value.path).catch(() => {})))
            throw failure.reason
          }
          const attachments = staged.filter((result) => result.status === "fulfilled").map((result) => result.value)
          const existingAttachments = new Set(attachments.filter((attachment) => attachmentOwners.has(attachment.id)).map((attachment) => attachment.id))
          attachments.forEach((attachment) => attachmentOwners.set(attachment.id, attachment))
          try {
            const text = parts
              .map((part) =>
                part.type === "text"
                  ? string(part.text)
                  : part.type === "file" && part.source && string(part.url).startsWith("file:")
                    ? `\n@${fileURLToPath(new URL(string(part.url)))}`
                    : part.type === "agent"
                      ? `\n@${string(part.name)}`
                      : "",
              )
              .join("\n")
            if (!session.messages.length)
              session.title =
                text.trim().slice(0, 72) ||
                attachments.map((attachment) => attachment.filename).join(", ").slice(0, 72) ||
                session.title
            const system = string(body.system)
            const handoffFrom = system.startsWith("codeink-handoff:") ? sessions.get(system.slice("codeink-handoff:".length)) : undefined
            if (handoffFrom && (handoffFrom.id === session.id || handoffFrom.directory !== session.directory || session.messages.length))
              throw new Error(t("invalidHandoff"))
            await sessions.send({
              sessionID: session.id,
              messageID: string(body.messageID) || undefined,
              agentID,
              directory: session.directory,
              model: modelID,
              variant: string(body.variant) || undefined,
              text,
              handoffContext: handoffFrom ? handoffContext(handoffFrom) : system.slice(0, 12_000) || undefined,
              attachments,
            })
          } catch (error) {
            await Promise.all(attachments.filter((attachment) => !existingAttachments.has(attachment.id)).map(async (attachment) => {
              attachmentOwners.delete(attachment.id)
              await unlink(attachment.path).catch(() => {})
            }))
            throw error
          }
          return json(true, 200)
        }
      }
      console.warn(`[agent-bridge] Unsupported route: ${method} ${path}`)
      json({ name: "Unsupported", data: { message: t("unsupportedFeature") } }, 501)
    })().catch((error: Error) => {
      if (!response.headersSent) response.writeHead(400, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ name: "UnknownError", data: { message: error.message } }))
    })
  })
  const terminals = createTerminals(server, env, emit)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, hostname, () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error(t("failed"))
  attachmentPort = address.port
  let stopping: Promise<void> | undefined
  return {
    listAgents,
    saveAgent,
    agentRules,
    setAgentRules,
    store,
    sessions,
    server,
    stop() {
      return (stopping ??= (async () => {
        clearTimeout(catalogTimer)
        catalog.dispose()
        streams.forEach((stream) => stream.response.end())
        terminals.stop()
        await sessions.dispose()
        server.closeAllConnections()
        await new Promise<void>((resolve) => server.close(() => resolve()))
      })())
    },
  }
}
