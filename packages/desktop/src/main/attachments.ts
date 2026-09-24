import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { fileURLToPath } from "node:url"
import { t } from "../shared/i18n"
import type { PromptAttachment } from "../shared/types"

export const attachmentPath = (directory: string, id: string) => join(directory, "attachments", id)

export async function stageAttachment(directory: string, part: Record<string, unknown>, messageID?: string): Promise<PromptAttachment> {
  const url = typeof part.url === "string" ? part.url : ""
  const mime = typeof part.mime === "string" ? part.mime : ""
  if (!url || !mime) throw new Error(t("invalidAttachment"))
  const filename = basename(typeof part.filename === "string" ? part.filename : "attachment")
  const data = url.startsWith("data:")
    ? (() => {
        const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(url)
        if (!match || match[1] !== mime) throw new Error(t("invalidAttachment"))
        if (match[2].length > 28 * 1024 * 1024) throw new Error(t("requestTooLarge"))
        return Buffer.from(match[2], "base64")
      })()
    : url.startsWith("file:")
      ? await (async () => {
          const path = fileURLToPath(new URL(url))
          if ((await stat(path)).size > 20 * 1024 * 1024) throw new Error(t("requestTooLarge"))
          return readFile(path)
        })()
      : undefined
  if (!data) throw new Error(t("invalidAttachment"))
  if (data.length > 20 * 1024 * 1024) throw new Error(t("requestTooLarge"))
  const hash = messageID && typeof part.id === "string"
    ? createHash("sha256").update(messageID).update(part.id).update(filename).update(mime).update(data).digest("hex")
    : undefined
  const id = hash
    ? `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`
    : randomUUID()
  await mkdir(join(directory, "attachments"), { recursive: true })
  await writeFile(attachmentPath(directory, id), data, { mode: 0o600 })
  return { id, filename, mime, path: attachmentPath(directory, id) }
}
