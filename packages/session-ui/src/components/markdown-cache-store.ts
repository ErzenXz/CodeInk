export type MarkdownCacheEntry = { raw: string; hash: string; html: string }

const maxEntries = 200
const maxBytes = 8 * 1024 * 1024
const cache = new Map<string, MarkdownCacheEntry>()
const size = (key: string, value: MarkdownCacheEntry) =>
  (key.length + value.raw.length + value.html.length + value.hash.length) * 2
let bytes = 0

export function getCachedMarkdown(key: string) {
  return cache.get(key)
}

export function touchCachedMarkdown(key: string, value: MarkdownCacheEntry) {
  const previous = cache.get(key)
  if (previous) bytes -= size(key, previous)
  cache.delete(key)
  // An oversized render still displays normally; retaining it would flush useful small entries.
  if (size(key, value) > maxBytes) return
  cache.set(key, value)
  bytes += size(key, value)
  while (cache.size > maxEntries || bytes > maxBytes) {
    const first = cache.keys().next().value
    if (first === undefined) return
    bytes -= size(first, cache.get(first)!)
    cache.delete(first)
  }
}
