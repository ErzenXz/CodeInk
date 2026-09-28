import type { Message, Part, PermissionRequest, QuestionRequest, SessionStatus, Todo } from "@codeink/sdk/v2/client"
import type { FileDiffInfo } from "@opencode-ai/client/promise"
import type { SessionMessageInfo } from "@opencode-ai/client/promise"

export const SESSION_CACHE_LIMIT = 8
export const SESSION_CACHE_BYTES = 16 * 1024 * 1024

type SessionCache = {
  session_status: Record<string, SessionStatus | undefined>
  session_diff: Record<string, FileDiffInfo[] | undefined>
  todo: Record<string, Todo[] | undefined>
  message: Record<string, Message[] | undefined>
  session_message: Record<string, SessionMessageInfo[] | undefined>
  part: Record<string, Part[] | undefined>
  permission: Record<string, PermissionRequest[] | undefined>
  question: Record<string, QuestionRequest[] | undefined>
  part_text_accum_delta: Record<string, string | undefined>
}

export function sessionCacheBytes(store: SessionCache, sessionID: string) {
  return (
    retainedBytes(store.session_message[sessionID]) +
    retainedBytes(store.session_diff[sessionID]) +
    (store.message[sessionID] ?? []).reduce((total, message) => total + 512 + retainedBytes(store.part[message.id]), 0)
  )
}

function retainedBytes(value: unknown): number {
  if (typeof value === "string") return value.length * 2
  if (Array.isArray(value)) return value.reduce((total, item) => total + retainedBytes(item), 32)
  if (!value || typeof value !== "object") return 8
  return Object.entries(value).reduce((total, [key, item]) => total + key.length * 2 + retainedBytes(item), 32)
}

export function dropSessionCaches(store: SessionCache, sessionIDs: Iterable<string>) {
  const stale = new Set(Array.from(sessionIDs).filter(Boolean))
  if (stale.size === 0) return

  for (const key of Object.keys(store.part)) {
    const parts = store.part[key]
    if (!parts?.some((part) => stale.has(part?.sessionID ?? ""))) continue
    for (const part of parts) {
      delete store.part_text_accum_delta[part.id]
    }
    delete store.part[key]
  }

  for (const sessionID of stale) {
    delete store.message[sessionID]
    delete store.todo[sessionID]
    delete store.session_message[sessionID]
    delete store.session_diff[sessionID]
    delete store.session_status[sessionID]
    delete store.permission[sessionID]
    delete store.question[sessionID]
  }
}

export function pickSessionCacheEvictions(input: {
  seen: Set<string>
  keep: string
  limit: number
  preserve?: Iterable<string>
  sizes?: ReadonlyMap<string, number>
  maxBytes?: number
}) {
  const stale: string[] = []
  const keep = new Set([input.keep, ...Array.from(input.preserve ?? [])])
  if (input.seen.has(input.keep)) input.seen.delete(input.keep)
  input.seen.add(input.keep)
  let bytes = [...input.seen].reduce((total, id) => total + (input.sizes?.get(id) ?? 0), 0)
  for (const id of input.seen) {
    if (input.seen.size - stale.length <= input.limit && bytes <= (input.maxBytes ?? Infinity)) break
    if (keep.has(id)) continue
    stale.push(id)
    bytes -= input.sizes?.get(id) ?? 0
  }
  for (const id of stale) {
    input.seen.delete(id)
  }
  return stale
}
