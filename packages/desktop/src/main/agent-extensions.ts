import { execFile } from "node:child_process"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"
import type {
  AgentExtension,
  AgentExtensionReport,
  AgentInstructions,
  AgentLimitWindow,
  AgentStatus,
  AgentUsageReport,
  Session,
} from "../shared/types"
import { t } from "../shared/i18n"
import { AgentProcess } from "./adapters/process"
import { array, object, string } from "./adapters/types"

const run = promisify(execFile)

// Reading extensions or plan limits spawns agent CLIs (1-2s), so keep results and refresh them in the background.
const cache = new Map<string, { at: number; value: Promise<unknown>; refresh?: Promise<unknown> }>()
function cached<T>(key: string, fresh: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (!hit) {
    const value = load()
    cache.set(key, { at: Date.now(), value })
    value.catch(() => cache.get(key)?.value === value && cache.delete(key))
    return value
  }
  // A stale entry keeps serving its last result while one shared refresh runs.
  if (Date.now() - hit.at >= fresh && !hit.refresh) {
    const next = load()
    hit.refresh = next
    next.then(
      () => cache.set(key, { at: Date.now(), value: next }),
      () => (hit.refresh = undefined),
    )
  }
  return hit.value as Promise<T>
}
const agentsKey = (agents: AgentStatus[]) => agents.map((agent) => `${agent.id}=${agent.executable ?? ""}`).join(",")

// Agents whose skills, plugins, and MCP servers CodeInk can read through an official API or CLI.
const managed = new Set(["codex", "claude"])

export async function listAgentExtensions(agents: AgentStatus[], env: NodeJS.ProcessEnv, refresh = false) {
  if (refresh) cache.delete(`extensions:${agentsKey(agents)}`)
  return cached(`extensions:${agentsKey(agents)}`, 5 * 60_000, () => loadAgentExtensions(agents, env))
}

async function loadAgentExtensions(agents: AgentStatus[], env: NodeJS.ProcessEnv) {
  return Promise.all(
    agents
      .filter((agent) => managed.has(agent.protocol) && agent.executable)
      .map(async (agent): Promise<AgentExtensionReport> => {
        const extensions = await (
          agent.protocol === "codex" ? codexExtensions(agent, env) : claudeExtensions(agent, env)
        )
          .then((extensions) => ({ extensions }))
          .catch((error: unknown) => ({ extensions: [], error: message(error) }))
        return { agentID: agent.id, name: agent.name, ...extensions }
      }),
  )
}

export async function setAgentExtensionEnabled(
  agents: AgentStatus[],
  env: NodeJS.ProcessEnv,
  input: { agentID: string; kind: AgentExtension["kind"]; id: string; path?: string; enabled: boolean },
) {
  const agent = agents.find((item) => item.id === input.agentID)
  if (!agent?.executable) throw new Error(t("missingAgent"))
  for (const key of cache.keys()) if (key.startsWith("extensions:")) cache.delete(key)
  if (agent.protocol === "codex" && input.kind === "skill") {
    await withCodex(agent, env, (rpc) =>
      rpc("skills/config/write", {
        enabled: input.enabled,
        ...(input.path ? { path: input.path } : { name: input.id }),
      }),
    )
    return
  }
  if (agent.protocol === "claude" && input.kind === "plugin") {
    await run(agent.executable, [...agent.args, "plugin", input.enabled ? "enable" : "disable", input.id], {
      env,
      timeout: 30_000,
    })
    return
  }
  throw new Error(t("unsupportedFeature"))
}

export async function readAgentUsage(
  agents: AgentStatus[],
  sessions: Session[],
  env: NodeJS.ProcessEnv,
  refresh = false,
) {
  if (refresh) cache.delete(`usage:${agentsKey(agents)}`)
  // Limits are cached briefly; CodeInk's own session totals are cheap and always current.
  const limits = await cached(`usage:${agentsKey(agents)}`, 60_000, () =>
    Promise.all(
      agents.map((agent) =>
        agentLimits(agent, env).catch((error: unknown) => ({
          windows: [] as AgentLimitWindow[],
          error: message(error),
        })),
      ),
    ),
  )
  const used = new Set(sessions.map((session) => session.agentID))
  return Promise.all(
    agents
      .map((agent, index) => ({ agent, limits: limits[index]! }))
      .filter((entry) => entry.agent.executable || used.has(entry.agent.id))
      .map(async ({ agent, limits }): Promise<AgentUsageReport> => {
        return {
          agentID: agent.id,
          name: agent.name,
          installed: !!agent.executable,
          ...limits,
          totals: usageTotals(sessions.filter((session) => session.agentID === agent.id)),
        }
      }),
  )
}

export async function readAgentInstructions(agents: AgentStatus[], env: NodeJS.ProcessEnv) {
  return Promise.all(
    Object.entries(instructionFiles(env)).flatMap(([id, path]) => {
      const agent = agents.find((item) => item.id === id)
      if (!agent) return []
      return [
        readFile(path, "utf8").then(
          (content): AgentInstructions => ({
            agentID: id,
            name: agent.name,
            installed: !!agent.executable,
            path,
            content,
            exists: true,
          }),
          (): AgentInstructions => ({
            agentID: id,
            name: agent.name,
            installed: !!agent.executable,
            path,
            content: "",
            exists: false,
          }),
        ),
      ]
    }),
  )
}

export async function writeAgentInstructions(env: NodeJS.ProcessEnv, agentID: string, content: string) {
  const path = instructionFiles(env)[agentID]
  if (!path) throw new Error(t("unknownAgent"))
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content, "utf8")
}

async function codexExtensions(agent: AgentStatus, env: NodeJS.ProcessEnv): Promise<AgentExtension[]> {
  return withCodex(agent, env, async (rpc) => {
    const [skills, plugins, servers] = await Promise.all([
      rpc("skills/list", { cwds: [homedir()] }),
      rpc("plugin/list", {}),
      rpc("mcpServerStatus/list", { detail: "toolsAndAuthOnly", limit: 200 }),
    ])
    return [
      ...array(skills.data)
        .flatMap((entry) => array(object(entry).skills))
        .map(object)
        .map((skill): AgentExtension => {
          const ui = object(skill.interface)
          return {
            id: string(skill.path) || string(skill.name),
            agentID: agent.id,
            kind: "skill",
            name: string(ui.displayName) || string(skill.name),
            description: string(ui.shortDescription) || string(skill.description) || undefined,
            source: string(skill.pluginId) || string(skill.scope) || undefined,
            path: string(skill.path) || undefined,
            enabled: skill.enabled !== false,
            toggleable: !!string(skill.path),
          }
        }),
      ...array(plugins.marketplaces)
        .map(object)
        .flatMap((market) =>
          array(market.plugins)
            .map(object)
            .filter((plugin) => plugin.installed === true)
            .map((plugin): AgentExtension => {
              const ui = object(plugin.interface)
              return {
                id: string(plugin.id),
                agentID: agent.id,
                kind: "plugin",
                name: string(ui.displayName) || string(plugin.name),
                description: string(ui.shortDescription) || undefined,
                source: string(market.name) || undefined,
                version: string(plugin.version) || string(plugin.localVersion) || undefined,
                path: string(object(plugin.source).path) || undefined,
                enabled: plugin.enabled !== false,
                toggleable: false,
              }
            }),
        ),
      ...array(servers.data)
        .map(object)
        .map(
          (server): AgentExtension => ({
            id: `mcp:${string(server.name)}`,
            agentID: agent.id,
            kind: "mcp",
            name: string(server.name),
            description: string(object(server.serverInfo).title) || undefined,
            source: string(server.pluginId) || undefined,
            status: string(server.runtimeStatus) || string(server.authStatus) || undefined,
            tools: Object.keys(object(server.tools)).length,
            toggleable: false,
          }),
        ),
    ]
  })
}

async function claudeExtensions(agent: AgentStatus, env: NodeJS.ProcessEnv): Promise<AgentExtension[]> {
  const home = claudeHome(env)
  const listed = await run(agent.executable!, [...agent.args, "plugin", "list", "--json"], {
    env,
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  })
  const plugins = array(JSON.parse(listed.stdout)).map(object)
  const settings = object(
    await readFile(claudeConfigFile(env), "utf8").then(
      (text) => JSON.parse(text) as unknown,
      () => ({}),
    ),
  )
  const pluginSkills = await Promise.all(
    plugins.map((plugin) =>
      readSkills(join(string(plugin.installPath), "skills"), agent.id, {
        source: string(plugin.id),
        enabled: plugin.enabled !== false,
      }),
    ),
  )
  return [
    ...(await readSkills(join(home, "skills"), agent.id, { source: "user", enabled: true })),
    ...pluginSkills.flat(),
    ...plugins.map(
      (plugin): AgentExtension => ({
        id: string(plugin.id),
        agentID: agent.id,
        kind: "plugin",
        name: string(plugin.id).split("@")[0] || string(plugin.id),
        source: string(plugin.id).split("@")[1] || string(plugin.scope) || undefined,
        version: string(plugin.version) || undefined,
        path: string(plugin.installPath) || undefined,
        enabled: plugin.enabled !== false,
        toggleable: true,
      }),
    ),
    ...plugins.flatMap((plugin) =>
      Object.entries(object(plugin.mcpServers)).map(
        ([name, config]): AgentExtension => ({
          id: `mcp:${string(plugin.id)}:${name}`,
          agentID: agent.id,
          kind: "mcp",
          name,
          description: string(object(config).url) || string(object(config).command) || undefined,
          source: string(plugin.id),
          enabled: plugin.enabled !== false,
          toggleable: false,
        }),
      ),
    ),
    ...Object.entries(object(settings.mcpServers)).map(
      ([name, config]): AgentExtension => ({
        id: `mcp:user:${name}`,
        agentID: agent.id,
        kind: "mcp",
        name,
        description: string(object(config).url) || string(object(config).command) || undefined,
        source: "user",
        toggleable: false,
      }),
    ),
  ]
}

async function readSkills(
  directory: string,
  agentID: string,
  owner: { source: string; enabled: boolean },
): Promise<AgentExtension[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const skills = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map(async (entry) => {
        const path = join(directory, entry.name, "SKILL.md")
        const meta = frontmatter(await readFile(path, "utf8").catch(() => ""))
        if (!meta) return []
        return [
          {
            id: path,
            agentID,
            kind: "skill" as const,
            name: meta.name || entry.name,
            description: meta.description || undefined,
            source: owner.source,
            path,
            enabled: owner.enabled,
            toggleable: false,
          },
        ]
      }),
  )
  return skills.flat()
}

// SKILL.md files open with YAML frontmatter; only single-line `name` and `description` are needed here.
function frontmatter(text: string) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]
  if (!block) return
  const field = (key: string) =>
    new RegExp(`^${key}:\\s*(.*)$`, "m")
      .exec(block)?.[1]
      ?.trim()
      .replace(/^(["'])(.*)\1$/, "$2")
  return { name: field("name"), description: field("description") }
}

async function agentLimits(
  agent: AgentStatus,
  env: NodeJS.ProcessEnv,
): Promise<Pick<AgentUsageReport, "plan" | "windows" | "source" | "fetchedAt">> {
  if (agent.protocol === "codex" && agent.executable) {
    return withCodex(agent, env, async (rpc) => {
      const [account, limits] = await Promise.all([rpc("account/read", {}), rpc("account/rateLimits/read", {})])
      const rate = object(limits.rateLimits)
      return {
        plan: planName(string(object(account.account).planType) || string(rate.planType)),
        source: "live",
        fetchedAt: Date.now(),
        windows: (["primary", "secondary"] as const).flatMap((key) => {
          const window = object(rate[key])
          if (typeof window.usedPercent !== "number") return []
          const minutes = typeof window.windowDurationMins === "number" ? window.windowDurationMins : 0
          return [
            {
              id: key,
              kind: minutes >= 7 * 24 * 60 ? "weekly" : minutes > 0 && minutes <= 24 * 60 ? "session" : "other",
              usedPercent: window.usedPercent,
              resetsAt: typeof window.resetsAt === "number" ? window.resetsAt * 1000 : undefined,
            } satisfies AgentLimitWindow,
          ]
        }),
      }
    })
  }
  if (agent.protocol === "claude") {
    // Claude Code keeps its most recent plan-usage snapshot in ~/.claude.json; there is no public API for it.
    const config = object(JSON.parse(await readFile(claudeConfigFile(env), "utf8").catch(() => "{}")))
    const cached = object(config.cachedUsageUtilization)
    const utilization = object(cached.utilization)
    const limits = array(utilization.limits).map(object)
    const windows: AgentLimitWindow[] = limits.length
      ? limits.flatMap((limit) =>
          typeof limit.percent === "number"
            ? [
                {
                  id: string(limit.kind) || string(limit.group),
                  kind: limit.group === "session" ? "session" : limit.group === "weekly" ? "weekly" : "other",
                  usedPercent: limit.percent,
                  resetsAt: Date.parse(string(limit.resets_at)) || undefined,
                  label: string(object(object(limit.scope).model).display_name) || undefined,
                  warning: limit.severity === "warning" || limit.severity === "critical" || undefined,
                },
              ]
            : [],
        )
      : (["five_hour", "seven_day"] as const).flatMap((key) => {
          const window = object(utilization[key])
          if (typeof window.utilization !== "number") return []
          return [
            {
              id: key,
              kind: key === "five_hour" ? "session" : "weekly",
              usedPercent: window.utilization,
              resetsAt: Date.parse(string(window.resets_at)) || undefined,
            } satisfies AgentLimitWindow,
          ]
        })
    return {
      plan: planName(string(object(config.oauthAccount).organizationType)),
      source: windows.length ? "cache" : undefined,
      fetchedAt: typeof cached.fetchedAtMs === "number" ? cached.fetchedAtMs : undefined,
      windows,
    }
  }
  return { windows: [] }
}

function usageTotals(sessions: Session[]): AgentUsageReport["totals"] {
  const messages = sessions.flatMap((session) => session.messages)
  const sum = (pick: (usage: NonNullable<(typeof messages)[number]["usage"]>) => number | undefined) =>
    messages.reduce((total, item) => total + (item.usage ? (pick(item.usage) ?? 0) : 0), 0)
  const costs = sessions.flatMap((session) => (typeof session.reportedCost === "number" ? [session.reportedCost] : []))
  const lastUsed = Math.max(0, ...sessions.map((session) => session.updatedAt))
  return {
    sessions: sessions.length,
    messages: messages.filter((item) => item.role === "user").length,
    input: sum((usage) => usage.input),
    output: sum((usage) => usage.output),
    cacheRead: sum((usage) => usage.cacheRead),
    cacheWrite: sum((usage) => usage.cacheWrite),
    cost: costs.length ? costs.reduce((total, value) => total + value, 0) : undefined,
    lastUsed: lastUsed || undefined,
  }
}

type Rpc = (method: string, params: unknown) => Promise<Record<string, unknown>>

async function withCodex<T>(agent: AgentStatus, env: NodeJS.ProcessEnv, use: (rpc: Rpc) => Promise<T>) {
  const proc = new AgentProcess({
    executable: agent.executable!,
    args: [...agent.args, "app-server"],
    directory: homedir(),
    env,
    message: () => {},
    error: () => {},
  })
  try {
    await proc.request(
      (id) => ({ id, method: "initialize", params: { clientInfo: { name: "codeink", version: "0.1.0" } } }),
      15_000,
    )
    proc.send({ method: "initialized", params: {} })
    return await use((method, params) =>
      proc.request((id) => ({ id, method, params }), 30_000).then((value) => object(value.result)),
    )
  } finally {
    proc.dispose()
  }
}

function instructionFiles(env: NodeJS.ProcessEnv): Record<string, string> {
  const home = homedir()
  return {
    codex: join(env.CODEX_HOME || join(home, ".codex"), "AGENTS.md"),
    claude: join(claudeHome(env), "CLAUDE.md"),
    opencode: join(env.XDG_CONFIG_HOME || join(home, ".config"), "opencode", "AGENTS.md"),
    gemini: join(home, ".gemini", "GEMINI.md"),
  }
}

function claudeHome(env: NodeJS.ProcessEnv) {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")
}

// Claude Code keeps `.claude.json` beside the config directory by default, or inside a custom CLAUDE_CONFIG_DIR.
function claudeConfigFile(env: NodeJS.ProcessEnv) {
  return env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, ".claude.json") : join(homedir(), ".claude.json")
}

function planName(value: string) {
  const plan = value.replace(/^claude_/, "")
  return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : undefined
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
