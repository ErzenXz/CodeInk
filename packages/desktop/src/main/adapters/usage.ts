import type { Usage } from "../../shared/types"
import { object } from "./types"

export function count(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

// Normalized categories are disjoint: cached input and reasoning must not be counted twice.
export function codexUsage(value: unknown): Usage {
  const usage = object(value)
  const last = object(usage.last)
  const input = count(last.inputTokens)
  const output = count(last.outputTokens)
  const read = count(last.cachedInputTokens)
  const reasoning = count(last.reasoningOutputTokens)
  return {
    input: input === undefined ? undefined : Math.max(0, input - (read ?? 0)),
    output: output === undefined ? undefined : Math.max(0, output - (reasoning ?? 0)),
    reasoning,
    cacheRead: read,
    total: count(last.totalTokens),
    contextUsed: count(last.totalTokens),
    contextLimit: count(usage.modelContextWindow),
  }
}

export function claudeUsage(value: unknown): Usage {
  const usage = object(value)
  const input = count(usage.input_tokens)
  const output = count(usage.output_tokens)
  const cacheRead = count(usage.cache_read_input_tokens)
  const cacheWrite = count(usage.cache_creation_input_tokens)
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total:
      input === undefined || output === undefined ? undefined : input + output + (cacheRead ?? 0) + (cacheWrite ?? 0),
  }
}

export function piUsage(value: unknown): Usage {
  const usage = object(value)
  const output = count(usage.output)
  const reasoning = count(usage.reasoning)
  return {
    input: count(usage.input),
    output: output === undefined ? undefined : Math.max(0, output - (reasoning ?? 0)),
    reasoning,
    cacheRead: count(usage.cacheRead),
    cacheWrite: count(usage.cacheWrite),
    total: count(usage.totalTokens),
  }
}

export function openCodeUsage(value: unknown): Usage {
  const usage = object(value)
  const input = count(usage.input)
  const output = count(usage.output)
  const reasoning = count(usage.reasoning)
  const cacheRead = count(object(usage.cache).read)
  const cacheWrite = count(object(usage.cache).write)
  return {
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    total:
      count(usage.total) ??
      (input === undefined || output === undefined
        ? undefined
        : input + output + (reasoning ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0)),
  }
}
