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
  if (!bridge) throw new Error(t("bridgeStarting"))
  return readAgentUsage(await bridge.listAgents(), bridge.store.state.sessions, process.env, refresh)
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
  bridge = await startBridge(hostname, port, password, options.userDataPath, process.env)
  // Warm the agent CLI reads after startup settles so Skills and Usage open instantly.
  setTimeout(() => {
    void listInstalledAgentExtensions().catch(() => undefined)
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
