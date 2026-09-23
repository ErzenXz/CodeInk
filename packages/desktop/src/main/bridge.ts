import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import { homedir } from "node:os"
import { basename, join, resolve } from "node:path"
import { realpath, stat } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { Agent, Session, Usage } from "../shared/types"
import type { Message, Part } from "@codeink/sdk/v2/client"
type LegacySession = import("@codeink/sdk/v2/client").Session
import { WorkspaceStore, agentSchema } from "./agent-store"
import { Sessions } from "./sessions"
import { detectAgents } from "./agents"
import { listFiles, previewFile } from "./files"
import { array, object, string } from "./adapters/types"
import { t } from "../shared/i18n"
import { createTerminals } from "./terminals"
import { ModelCatalog } from "./model-catalog"
import { savedTool, toolInfo } from "./adapters/tool-info"

const projectID = (directory: string) => createHash("sha256").update(directory).digest("hex").slice(0, 40)
const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
const toolCache = new WeakMap<object, { text: string; info: ReturnType<typeof savedTool> }>()
function sessionCost(session: Session) {
  if (session.reportedCost !== undefined) return session.reportedCost
  const users = session.messages.filter((message) => message.role === "user")
  if (!users.length || users.some((message) => !message.costs)) return undefined
  return users.reduce((sum, message) => sum + Object.values(message.costs ?? {}).reduce((a, b) => a + b, 0), 0)
}

export function legacySession(session: Session): LegacySession {
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
    cost: sessionCost(session) ?? 0,
    ...{ codeinkCostKnown: sessionCost(session) !== undefined },
    tokens,
  }
}

// The upstream renderer consumes its original wire format. Protocol translation
// stays here so its session layout, timeline, composer and panels remain intact.
export function legacyMessages(session: Session): { info: Message; parts: Part[] }[] {
  const result: { info: Message; parts: Part[] }[] = []
  let parent = ""
  let model = session.model
  let usage: Usage | undefined
  let cost: number | undefined
  let current: { info: Message; parts: Part[] } | undefined
  session.messages.forEach((message, index) => {
    const createdAt = message.createdAt ?? session.createdAt ?? session.updatedAt
    const completedAt = message.completedAt ?? createdAt
    const partID = `prt_${index.toString().padStart(12, "0")}${createHash("sha256").update(message.id).digest("hex").slice(0, 12)}`
    if (message.role === "user") {
      if (current?.info.role === "assistant") {
        current.info.time.completed ??= createdAt
        current.info.finish = "stop"
      }
      parent = message.id
      usage = message.usage
      model = usage?.model ?? message.model ?? session.model
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
        parts: [{ id: partID, messageID: message.id, sessionID: session.id, type: "text", text: message.text }],
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
          mode: "build",
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
  return result
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
  const streams = new Set<{ response: ServerResponse; directory?: string; global: boolean }>()
  const snapshots = new Map<string, Map<string, string>>()
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
    const next = new Map<string, string>()
    const changed = (key: string, value: unknown, type: string, properties: unknown) => {
      const serialized = JSON.stringify(value)
      next.set(key, serialized)
      if (previous.get(key) !== serialized) emit(session.directory, type, properties)
    }
    const info = legacySession(session)
    changed("session", info, "session.updated", { info })
    for (const message of legacyMessages(session)) {
      changed(message.info.id, message.info, "message.updated", { info: message.info })
      message.parts.forEach((part) => changed(part.id, part, "message.part.updated", { part }))
    }
    for (const approval of session.approvals) {
      const value = approval.questions ? question(session, approval) : permission(session, approval)
      changed(`approval:${value.id}`, value, approval.questions ? "question.asked" : "permission.asked", value)
    }
    const status = { type: session.status === "running" ? "busy" : "idle" }
    changed("status", status, "session.status", { sessionID: session.id, status })
    if (status.type === "idle" && previous.get("status") !== JSON.stringify(status))
      emit(session.directory, "session.idle", { sessionID: session.id })
    snapshots.set(session.id, next)
  }
  const sessions = new Sessions(store, env, publish)
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
      if (size > 2 * 1024 * 1024) throw new Error(t("requestTooLarge"))
      chunks.push(Buffer.from(chunk))
    }
    return chunks.length ? object(JSON.parse(Buffer.concat(chunks).toString("utf8"))) : {}
  }
  const server = createServer((request, response) => {
    void (async () => {
      const origin = request.headers.origin
      if (origin && (origin === "codeink://renderer" || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)))
        response.setHeader("Access-Control-Allow-Origin", origin)
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization,Content-Type,x-opencode-directory,x-opencode-workspace,x-opencode-ticket",
      )
      response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,PUT,OPTIONS")
      if (request.method === "OPTIONS") {
        response.writeHead(204).end()
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
      if ((path === "/session" || path === "/experimental/session") && method === "GET")
        return json(
          store.state.sessions
            .filter(
              (item) =>
                (!url.searchParams.has("directory") || item.directory === cwd) &&
                (!url.searchParams.get("search") || item.title.includes(url.searchParams.get("search")!)),
            )
            .map(legacySession),
        )
      if (path === "/session" && method === "POST") {
        await project(cwd)
        const session: Session = {
          id: `ses_${randomUUID().replaceAll("-", "")}`,
          agentID: store.state.selectedAgent,
          directory: cwd,
          model: "",
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
          await sessions.archive(session.id)
          emit(session.directory, "session.deleted", { info: legacySession(session) })
          return json(true)
        }
        if (action === "abort") {
          await sessions.stop(session.id)
          return json(true)
        }
        if (["children", "todo", "diff"].includes(action!)) return json([])
        if (action === "message" && method === "GET") return json(legacyMessages(session))
        if (action?.startsWith("message/") && method === "GET")
          return json(legacyMessages(session).find((item) => item.info.id === action.slice(8)))
        if (action === "prompt_async" || (action === "message" && method === "POST")) {
          const model = object(body.model)
          const agentID = string(model.providerID).replace(/^local-/, "") || session.agentID
          const modelID = string(model.modelID) === "default" ? "" : string(model.modelID)
          if (!session.messages.length) {
            session.agentID = agentID
            session.model = modelID
          }
          const parts = array(body.parts).map(object)
          if (parts.some((part) => part.type === "file" && !string(part.url).startsWith("file:")))
            throw new Error(t("unsupportedAttachments"))
          const text = parts
            .map((part) =>
              part.type === "text" ? string(part.text) : part.type === "file" ? `\n@${string(part.url)}` : "",
            )
            .join("\n")
          if (!session.messages.length) session.title = text.trim().slice(0, 72)
          await sessions.send({
            sessionID: session.id,
            messageID: string(body.messageID) || undefined,
            agentID,
            directory: session.directory,
            model: modelID,
            variant: string(body.variant) || undefined,
            text,
          })
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
  let stopping: Promise<void> | undefined
  return {
    listAgents,
    saveAgent,
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
