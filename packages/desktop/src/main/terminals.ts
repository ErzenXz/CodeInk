import { t } from "../shared/i18n"
import type { Server } from "node:http"
import { randomUUID } from "node:crypto"
import { basename } from "node:path"
import { WebSocket, WebSocketServer } from "ws"
import type { IPty } from "@lydell/node-pty"
import { getUserShell } from "./shell-env"
import { array, object, string } from "./adapters/types"

export function createTerminals(
  server: Server,
  env: NodeJS.ProcessEnv,
  emit: (directory: string, type: string, properties: unknown) => void,
) {
  const terminals = new Map<
    string,
    {
      process: IPty
      info: {
        id: string
        title: string
        command: string
        args: string[]
        cwd: string
        status: "running" | "exited"
        pid: number
      }
      buffer: string
      offset: number
      sockets: Set<WebSocket>
    }
  >()
  const tickets = new Map<string, { id: string; expires: number }>()
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url!, "http://127.0.0.1")
    const id = /^\/pty\/([^/]+)\/connect$/.exec(url.pathname)?.[1]
    const ticket = url.searchParams.get("ticket") ?? ""
    const entry = tickets.get(ticket)
    tickets.delete(ticket)
    const terminal = id ? terminals.get(id) : undefined
    if (!terminal || !entry || entry.id !== id || entry.expires < Date.now()) {
      socket.destroy()
      return
    }
    sockets.handleUpgrade(request, socket, head, (client) => {
      terminal.sockets.add(client)
      const cursor = Math.max(
        terminal.offset,
        Math.min(Number(url.searchParams.get("cursor")) || 0, terminal.offset + terminal.buffer.length),
      )
      client.send(Buffer.concat([Buffer.from([0]), Buffer.from(JSON.stringify({ cursor }))]))
      const replay = terminal.buffer.slice(cursor - terminal.offset)
      if (replay) client.send(replay)
      client.on("message", (data) => {
        if (terminal.info.status === "running") terminal.process.write(data.toString())
      })
      client.on("close", () => terminal.sockets.delete(client))
      client.on("error", () => client.close())
    })
  })
  const info = (id: string, cwd: string) => {
    const terminal = terminals.get(id)
    if (!terminal || terminal.info.cwd !== cwd) throw new Error(t("unknownTerminal"))
    return terminal
  }
  return {
    async route(path: string, method: string, cwd: string, body: Record<string, unknown>) {
      if (path === "/pty/shells") return [{ path: getUserShell(), name: basename(getUserShell()), acceptable: true }]
      if (path === "/pty" && method === "GET")
        return [...terminals.values()].filter((item) => item.info.cwd === cwd).map((item) => item.info)
      if (path === "/pty" && method === "POST") {
        const { spawn } = await import("@lydell/node-pty")
        const command = string(body.command) || (process.platform === "win32" ? "powershell.exe" : getUserShell())
        const args = body.args ? array(body.args).map(string) : process.platform === "win32" ? [] : ["-l"]
        const processEnv = Object.fromEntries(
          Object.entries({ ...env, ...object(body.env), TERM: "xterm-256color" }).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
        const proc = spawn(command, args, { cwd, env: processEnv, cols: 100, rows: 28, name: "xterm-256color" })
        const terminal = {
          process: proc,
          info: {
            id: `pty_${randomUUID().replaceAll("-", "")}`,
            title: string(body.title) || basename(command),
            command,
            args,
            cwd,
            status: "running" as "running" | "exited",
            pid: proc.pid,
          },
          buffer: "",
          offset: 0,
          sockets: new Set<WebSocket>(),
        }
        terminals.set(terminal.info.id, terminal)
        proc.onData((data) => {
          terminal.buffer += data
          if (terminal.buffer.length > 100000) {
            const removed = terminal.buffer.length - 100000
            terminal.buffer = terminal.buffer.slice(removed)
            terminal.offset += removed
          }
          terminal.sockets.forEach((socket) => {
            if (socket.readyState === WebSocket.OPEN) socket.send(data)
          })
        })
        proc.onExit(({ exitCode }) => {
          terminal.info.status = "exited"
          emit(cwd, "pty.exited", { id: terminal.info.id, exitCode })
          terminal.sockets.forEach((socket) => socket.close())
        })
        emit(cwd, "pty.created", { info: terminal.info })
        return terminal.info
      }
      const match = /^\/pty\/([^/]+)(?:\/(connect-token))?$/.exec(path)
      if (!match) throw new Error(t("unsupportedTerminal"))
      const terminal = info(match[1], cwd)
      if (match[2] === "connect-token") {
        for (const [key, value] of tickets) if (value.expires < Date.now()) tickets.delete(key)
        const ticket = randomUUID()
        tickets.set(ticket, { id: match[1], expires: Date.now() + 30000 })
        return { ticket, expires_in: 30 }
      }
      if (method === "DELETE") {
        terminal.process.kill()
        terminal.sockets.forEach((socket) => socket.close())
        terminals.delete(match[1])
        emit(cwd, "pty.deleted", { id: match[1] })
        return true
      }
      if (method === "PUT") {
        const size = object(body.size)
        if (typeof size.cols === "number" && typeof size.rows === "number")
          terminal.process.resize(Math.max(1, Math.min(1000, size.cols)), Math.max(1, Math.min(1000, size.rows)))
        if (body.title) terminal.info.title = string(body.title)
      }
      return terminal.info
    },
    stop() {
      terminals.forEach((terminal) => {
        terminal.sockets.forEach((socket) => socket.terminate())
        if (terminal.info.status === "running") terminal.process.kill()
      })
      terminals.clear()
      sockets.close()
    },
  }
}
