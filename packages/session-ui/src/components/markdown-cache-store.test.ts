import { expect, test } from "bun:test"
import { getCachedMarkdown, touchCachedMarkdown } from "./markdown-cache-store"

test("highlighted HTML evicts old entries by bytes, even below the entry cap", () => {
  Array.from({ length: 12 }, (_, index) =>
    touchCachedMarkdown(`large-${index}`, {
      raw: "x".repeat(100_000),
      hash: "hash",
      html: "<span>code</span>".repeat(32_000),
    }),
  )
  expect(getCachedMarkdown("large-0")).toBeUndefined()
  expect(getCachedMarkdown("large-11")).toBeDefined()
})

test("replacing and touching entries updates accounting and preserves recent small renders", () => {
  const small = { raw: "small", hash: "hash", html: "<p>small</p>" }
  touchCachedMarkdown("recent", small)
  const large = { raw: "x".repeat(500_000), hash: "hash", html: "y".repeat(500_000) }
  Array.from({ length: 12 }, () => touchCachedMarkdown("replace", large))
  expect(getCachedMarkdown("recent")).toBe(small)
  touchCachedMarkdown("replace", small)
  touchCachedMarkdown("oversized", { ...large, html: "x".repeat(5_000_000) })
  expect(getCachedMarkdown("oversized")).toBeUndefined()
  expect(getCachedMarkdown("recent")).toBe(small)
  expect(getCachedMarkdown("replace")).toBe(small)
})
