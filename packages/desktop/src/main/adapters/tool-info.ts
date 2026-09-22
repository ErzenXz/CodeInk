import type { ToolInfo } from "../../shared/types"
import { array, detail, object, string } from "./types"

const names: Record<string, string> = {
  Bash: "bash",
  Read: "read",
  Write: "write",
  Edit: "edit",
  MultiEdit: "edit",
  Glob: "glob",
  Grep: "grep",
  WebFetch: "webfetch",
  WebSearch: "websearch",
  Task: "task",
  Agent: "task",
  TodoWrite: "todowrite",
  commandExecution: "bash",
  fileChange: "apply_patch",
  webSearch: "websearch",
}

export function toolInfo(name: string, input: unknown = {}, extra: Partial<ToolInfo> = {}): ToolInfo {
  const value = object(input)
  return {
    name: names[name] ?? name,
    input: {
      ...value,
      ...(value.file_path || value.path ? { filePath: value.file_path ?? value.path } : {}),
      ...(value.old_string !== undefined ? { oldString: value.old_string } : {}),
      ...(value.new_string !== undefined ? { newString: value.new_string } : {}),
    },
    ...extra,
  }
}

export function codexTool(item: Record<string, unknown>, completed: boolean): ToolInfo {
  const type = string(item.type)
  const changes = array(item.changes).map(object)
  const name = type === "mcpToolCall" ? `${string(item.server)}/${string(item.tool)}` : type
  return toolInfo(
    name,
    type === "commandExecution"
      ? { command: item.command, description: item.command }
      : type === "webSearch"
        ? { query: item.query }
        : type === "fileChange"
          ? { patchText: changes.map((change) => string(change.diff)).join("\n") }
          : item.arguments,
    {
      title: string(item.command) || string(item.tool) || type,
      status:
        item.status === "failed" || (typeof item.exitCode === "number" && item.exitCode !== 0)
          ? "error"
          : completed
            ? "completed"
            : "running",
      output: string(item.aggregatedOutput) || (item.result ? detail(item.result) : undefined),
      error: item.error ? detail(item.error) : undefined,
      metadata:
        type === "fileChange"
          ? {
              files: changes.map((change) => ({
                filePath: change.path,
                type: object(change.kind).type ?? change.kind,
                diff: change.diff,
              })),
            }
          : {},
    },
  )
}

// Older CodeInk stores flattened tool events. Recover their action without
// modifying the user's saved history or treating event JSON as instructions.
export function savedTool(text: string): ToolInfo {
  const newline = text.indexOf("\n")
  const first = newline < 0 ? text : text.slice(0, newline)
  const payload = text.startsWith("{") ? text : newline < 0 ? "{}" : text.slice(newline + 1)
  const parsed: unknown = (() => {
    try {
      return JSON.parse(payload)
    } catch {
      return undefined
    }
  })()
  const value = object(parsed)
  if (text.startsWith("{") && value.type) return codexTool(value, true)
  const name = /^[a-z][\w./-]{0,80}$/i.test(first) ? first : "tool"
  return toolInfo(name, value.input ?? value, {
    status: "completed",
    title: string(value.title) || name,
    output: string(value.output) || text,
    metadata: object(value.metadata),
  })
}
