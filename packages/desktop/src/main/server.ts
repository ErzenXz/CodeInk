import { t } from "../shared/i18n"
import { startBridge } from "./bridge"
import type { Agent, AgentExtension, AgentRules } from "../shared/types"
import {
  listAgentExtensions,
  readAgentInstructions,
  readAgentUsage,
  setAgentExtensionEnabled,
  writeAgentInstructions,
} from "./agent-extensions"
import { getLogger } from "./logging"
import { getUserShell, loadShellEnv } from "./shell-env"
import { getStore } from "./store"
import { DEFAULT_SERVER_URL_KEY } from "./store-keys"
import { usageMonitoringEnabled } from "./usage-monitoring"
import { readOpenUsageCLI, readOpenUsageReports } from "./openusage"
import type { GatewayProvider } from "./gateway-keys"

export type HealthCheck = { wait: Promise<void> }

export type SidecarListener = { stop: () => Promise<void> }

type SpawnLocalServerOptions = {
  userDataPath: string
  onStdout?: (message: string) => void
  onStderr?: (message: string) => void
  onExit?: (code: number) => void
}

export function getDefaultServerUrl(): string | null {
  const value = getStore().get(DEFAULT_SERVER_URL_KEY)
  return typeof value === "string" ? value : null
}

export function setDefaultServerUrl(url: string | null) {
  if (url) {
    getStore().set(DEFAULT_SERVER_URL_KEY, url)
    return
  }

  getStore().delete(DEFAULT_SERVER_URL_KEY)
}

export function preferAppEnv(userDataPath: string) {
  const shell = process.platform === "win32" ? null : getUserShell()
  const shellEnv = shell ? loadShellEnv(shell, getLogger()) : null
  Object.assign(process.env, {
    ...shellEnv,
  })
  return shellEnv
}

let bridge: Awaited<ReturnType<typeof startBridge>> | undefined

export async function listInstalledAgents() {
  if (!bridge) throw new Error(t("bridgeStarting"))
  return bridge.listAgents()
}
export async function saveInstalledAgent(agent: Agent) {
  if (!bridge) throw new Error(t("bridgeStarting"))
  return bridge.saveAgent(agent)
}
export function gatewayStatus() {
  if (!bridge) throw new Error(t("bridgeStarting"))
  return bridge.gatewayStatus()
}
export async function setGatewayKey(provider: GatewayProvider, key: string) {
  if (!bridge) throw new Error(t("bridgeStarting"))
  return bridge.setGatewayKey(provider, key)
}
export function handoffPrompt(sessionID: string) {
  if (!bridge) throw new Error(t("bridgeStarting"))
  return bridge.handoffPrompt(sessionID)
}
export async function listAgentRules() {
  if (!bridge) throw new Error(t("bridgeStarting"))
  return bridge.agentRules()
}
export async function setAgentRules(agentID: string, rules: AgentRules) {
  if (!bridge) throw new Error(t("bridgeStarting"))
  return bridge.setAgentRules(agentID, rules)
}
export async function listInstalledAgentExtensions(refresh = false) {
  return listAgentExtensions(await listInstalledAgents(), process.env, refresh)
}
export async function setInstalledAgentExtensionEnabled(input: {
  agentID: string
  kind: AgentExtension["kind"]
  id: string
  path?: string
  enabled: boolean
}) {
  return setAgentExtensionEnabled(await listInstalledAgents(), process.env, input)
}
export async function readInstalledAgentUsage(refresh = false) {
  if (!usageMonitoringEnabled()) return []
  if (!bridge) throw new Error(t("bridgeStarting"))
  const external = await readOpenUsageReports().catch(() =>
    usageMonitoringEnabled()
      ? readOpenUsageCLI("openusage", refresh ? ["--force"] : []).catch(() => [])
      : [],
  )
  if (!usageMonitoringEnabled()) return []
  const externalFamilies = new Set(external.filter((report) => !report.stale && report.fetchedAt && Date.now() - report.fetchedAt < 10 * 60_000)
    .map((report) => report.agentID.slice("openusage:".length).split(":")[0]))
  const agents = await bridge.listAgents()
  if (!usageMonitoringEnabled()) return []
  const families = new Map(agents.map((agent) => [agent.id, agent.protocol]))
  const skipIDs = new Set(agents.filter((agent) => externalFamilies.has(agent.protocol)).map((agent) => agent.id))
  const native = await readAgentUsage(agents, bridge.store.state.sessions, process.env, refresh, skipIDs)
  if (!usageMonitoringEnabled()) return []
  return [
    ...native.filter((report) => !skipIDs.has(report.agentID)),
    ...external.filter((report) => {
      const family = report.agentID.slice("openusage:".length).split(":")[0]
      return externalFamilies.has(family) || !native.some((item) => families.get(item.agentID) === family)
    }).map((report) => {
      const family = report.agentID.slice("openusage:".length).split(":")[0]
      const matches = native.filter((item) => families.get(item.agentID) === family)
      return matches.length === 1 && external.filter((item) => item.agentID.slice("openusage:".length).split(":")[0] === family).length === 1
        ? { ...report, totals: matches[0].totals }
        : report
    }),
  ]
}
export function runningAgentSessions() {
  if (!bridge) return []
  const names = new Map(bridge.store.state.agents.map((agent) => [agent.id, agent.name]))
  return bridge.store.state.sessions
    .filter((session) => session.status === "running")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((session) => ({
      id: session.id,
      title: session.title,
      directory: session.directory,
      agent: names.get(session.agentID) ?? session.agentID,
    }))
}
export function subscribeAgentSessionStatus(listener: () => void) {
  return bridge?.subscribeSessionStatus(listener) ?? (() => undefined)
}
export async function readInstalledAgentInstructions() {
  return readAgentInstructions(await listInstalledAgents(), process.env)
}
export async function writeInstalledAgentInstructions(agentID: string, content: string) {
  return writeAgentInstructions(process.env, agentID, content)
}
export async function spawnLocalServer(
  hostname: string,
  port: number,
  password: string,
  options: SpawnLocalServerOptions,
) {
  bridge = await startBridge(hostname, port, password, options.userDataPath, process.env, usageMonitoringEnabled)
  // Warm usage only after an explicit opt-in. Skills load when the user opens that page.
  setTimeout(() => {
    void readInstalledAgentUsage().catch(() => undefined)
  }, 8_000).unref()
  return { listener: { stop: () => bridge!.stop() }, health: { wait: Promise.resolve() } }
}

export async function checkHealth(url: string, password?: string | null): Promise<boolean> {
  let healthUrls: URL[]
  try {
    healthUrls = [new URL("/api/health", url), new URL("/global/health", url)]
  } catch {
    return false
  }

  const headers = new Headers()
  if (password) {
    const auth = Buffer.from(`opencode:${password}`).toString("base64")
    headers.set("authorization", `Basic ${auth}`)
  }

  for (const healthUrl of healthUrls) {
    try {
      const res = await fetch(healthUrl, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(3000),
      })
      if (res.ok) return true
    } catch {}
  }
  return false
}
