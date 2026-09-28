import { checksum } from "@codeink/core/util/encode"
import DOMPurify from "dompurify"
import { parseMarkdown } from "./markdown-worker"
import { getCachedMarkdown, touchCachedMarkdown } from "./markdown-cache-store"
export { getCachedMarkdown, touchCachedMarkdown, type MarkdownCacheEntry } from "./markdown-cache-store"
const config = {
  USE_PROFILES: { html: true, mathMl: true },
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["style"],
  FORBID_CONTENTS: ["style", "script"],
  ADD_TAGS: ["svg", "path"],
  ADD_ATTR: ["d", "viewBox", "preserveAspectRatio", "xmlns", "target"],
}

if (typeof window !== "undefined" && DOMPurify.isSupported) {
  DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
    if (!(node instanceof HTMLAnchorElement)) return
    if (node.target !== "_blank") return

    const rel = node.getAttribute("rel") ?? ""
    const set = new Set(rel.split(/\s+/).filter(Boolean))
    set.add("noopener")
    set.add("noreferrer")
    node.setAttribute("rel", Array.from(set).join(" "))
  })
}

export function sanitizeMarkdown(html: string) {
  if (!DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(html, config)
}

export async function preloadMarkdown(text: string, cacheKey: string) {
  const key = `${cacheKey}:0:full`
  const cached = getCachedMarkdown(key)
  if (cached?.raw === text) {
    touchCachedMarkdown(key, cached)
    return
  }
  const hash = checksum(text)
  if (!hash) return
  touchCachedMarkdown(key, {
    raw: text,
    hash,
    html: sanitizeMarkdown(await parseMarkdown(text)),
  })
}
