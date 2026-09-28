import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export type GatewayProvider = "vercel" | "openrouter"
export type GatewayKeys = Partial<Record<GatewayProvider, string>>

export const gatewayEndpoints: Record<GatewayProvider, string> = {
  vercel: "https://ai-gateway.vercel.sh/v1",
  openrouter: "https://openrouter.ai/api/v1",
}

export class GatewayKeyStore {
  private keys: GatewayKeys = {}
  private writing = Promise.resolve()
  constructor(private path: string) {}

  async load() {
    const source = await readFile(this.path, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined
      throw error
    })
    if (!source) return
    const stored: unknown = JSON.parse(source)
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) throw new Error("Invalid gateway key store")
    const value = stored as Record<string, unknown>
    this.keys = {
      ...(typeof value.vercel === "string" ? { vercel: value.vercel } : {}),
      ...(typeof value.openrouter === "string" ? { openrouter: value.openrouter } : {}),
    }
  }

  get(provider: GatewayProvider) {
    return this.keys[provider]
  }

  status() {
    return { vercel: !!this.keys.vercel, openrouter: !!this.keys.openrouter }
  }

  async set(provider: GatewayProvider, key: string) {
    const next = this.writing.then(async () => {
      const previous = this.keys
      this.keys = { ...this.keys, [provider]: key.trim() || undefined }
      try {
        await mkdir(dirname(this.path), { recursive: true })
        await writeFile(`${this.path}.tmp`, JSON.stringify(this.keys), { mode: 0o600 })
        await rename(`${this.path}.tmp`, this.path)
      } catch (error) {
        this.keys = previous
        throw error
      }
      return this.status()
    })
    this.writing = next.then(
      () => {},
      () => {},
    )
    return next
  }
}
