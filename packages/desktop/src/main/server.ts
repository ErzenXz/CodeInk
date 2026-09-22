import { t } from "../shared/i18n"
import { startBridge } from "./bridge"
import type { Agent } from "../shared/types"
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
export async function spawnLocalServer(
  hostname: string,
  port: number,
  password: string,
  options: SpawnLocalServerOptions,
) {
  bridge = await startBridge(hostname, port, password, options.userDataPath, process.env)
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
