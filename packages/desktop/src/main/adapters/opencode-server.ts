import { randomBytes } from "node:crypto"
import { t } from "../../shared/i18n"
import { AgentProcess } from "./process"
import type { AdapterOptions } from "./types"

export function openCodeServer(
  options: Pick<AdapterOptions, "agent" | "executable" | "directory" | "env"> & {
    error: (message: string) => void
    signal?: AbortSignal
  },
) {
  const password = randomBytes(32).toString("hex")
  const controller = new AbortController()
  const listening = Promise.withResolvers<string>()
  let output = ""
  let disposed = false
  const timer = setTimeout(() => listening.reject(new Error(t("connectionTimeout"))), 15_000)
  const proc = new AgentProcess({
    ...options,
    env: { ...options.env, OPENCODE_SERVER_USERNAME: "codeink", OPENCODE_SERVER_PASSWORD: password },
    args: [...options.agent.args, "serve", "--hostname", "127.0.0.1", "--port", "0"],
    message: () => {},
    error: (message) => {
      clearTimeout(timer)
      listening.reject(new Error(message))
      options.error(message)
    },
    raw: (chunk) => {
      output = (output + chunk).slice(-8000)
      const address = output.match(/https?:\/\/127\.0\.0\.1:\d+/)?.[0]
      if (!address) return
      clearTimeout(timer)
      listening.resolve(address)
    },
  })
  void listening.promise.catch(() => {})
  const dispose = () => {
    if (disposed) return
    disposed = true
    clearTimeout(timer)
    options.signal?.removeEventListener("abort", dispose)
    listening.reject(new Error(t("processStopped")))
    controller.abort()
    proc.dispose()
  }
  options.signal?.addEventListener("abort", dispose, { once: true })
  if (options.signal?.aborted) dispose()
  return {
    async request(path: string, body?: unknown, stream = false) {
      const address = await listening.promise
      const response = await fetch(`${address}${path}?directory=${encodeURIComponent(options.directory)}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`codeink:${password}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: stream ? controller.signal : AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
      })
      if (!response.ok) throw new Error((await response.text()).slice(0, 4000) || response.statusText)
      return response
    },
    dispose,
  }
}
