import { execFile, type ChildProcessWithoutNullStreams } from "node:child_process"
import crossSpawn from "cross-spawn"
import { StringDecoder } from "node:string_decoder"
import { randomUUID } from "node:crypto"
import { t } from "../../shared/i18n"
import { object, string } from "./types"

// LF framing also preserves Unicode separators and split UTF-8 characters.
export class JsonLines {
  private decoder = new StringDecoder("utf8")
  private buffer = ""
  push(chunk: Buffer, receive: (message: Record<string, unknown>) => void) {
    this.buffer += this.decoder.write(chunk)
    if (this.buffer.length > 16 * 1024 * 1024) throw new Error(t("malformedProtocol"))
    for (;;) {
      const end = this.buffer.indexOf("\n")
      if (end < 0) return
      const line = this.buffer.slice(0, end).trim()
      this.buffer = this.buffer.slice(end + 1)
      if (!line) continue
      receive(object(JSON.parse(line)))
    }
  }
}

export class AgentProcess {
  readonly child: ChildProcessWithoutNullStreams
  private closed = false
  private intentional = false
  private stderr = ""
  private requests = new Map<
    string,
    {
      resolve: (value: Record<string, unknown>) => void
      reject: (error: Error) => void
      timer?: ReturnType<typeof setTimeout>
    }
  >()

  constructor(input: {
    executable: string
    args: string[]
    directory: string
    env: NodeJS.ProcessEnv
    message: (value: Record<string, unknown>) => void
    error: (message: string) => void
    raw?: (chunk: string) => void
  }) {
    this.child = crossSpawn(input.executable, input.args, {
      cwd: input.directory,
      env: input.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
      shell: false,
    }) as ChildProcessWithoutNullStreams
    const parser = new JsonLines()
    const fail = (message: string) => {
      if (this.closed) return
      this.closed = true
      this.rejectAll(new Error(message))
      if (!this.intentional) input.error(message)
    }
    this.child.stdout.on("data", (chunk: Buffer) => {
      if (input.raw) return input.raw(chunk.toString("utf8"))
      try {
        parser.push(chunk, (value) => {
          const nested = object(value.response)
          const id = String(value.id ?? nested.request_id ?? "")
          const request = this.requests.get(id)
          if (!request || value.method || value.type === "control_request") return input.message(value)
          this.requests.delete(id)
          clearTimeout(request.timer)
          if (value.error || value.success === false || nested.subtype === "error") {
            request.reject(
              new Error(
                string(object(value.error).message) || string(value.error) || string(nested.error) || t("failed"),
              ),
            )
            return
          }
          request.resolve(value)
        })
      } catch {
        fail(t("malformedProtocol"))
        this.dispose()
      }
    })
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString("utf8")).slice(-8000)
    })
    this.child.stdin.on("error", (error) => fail(error.message))
    this.child.on("error", (error) => fail(error.message))
    this.child.on("close", (code) => fail(this.stderr.trim() || `${t("connectionClosed")} (${code ?? "signal"})`))
  }

  send(message: unknown) {
    if (this.closed) throw new Error(t("processStopped"))
    this.child.stdin.write(JSON.stringify(message) + "\n")
  }

  request(make: (id: string) => unknown, timeout = 60_000): Promise<Record<string, unknown>> {
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer =
        timeout === 0
          ? undefined
          : setTimeout(() => {
              this.requests.delete(id)
              reject(new Error(t("connectionTimeout")))
            }, timeout)
      this.requests.set(id, { resolve, reject, timer })
      try {
        this.send(make(id))
      } catch (error) {
        clearTimeout(timer)
        this.requests.delete(id)
        reject(error)
      }
    })
  }

  private rejectAll(error: Error) {
    for (const pending of this.requests.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.requests.clear()
  }

  dispose() {
    if (this.intentional) return
    this.intentional = true
    this.rejectAll(new Error(t("processStopped")))
    const pid = this.child.pid
    if (!pid) return
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32") process.kill(-pid, signal)
        else execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => {})
      } catch {
        /* The process may already have exited. */
      }
    }
    kill("SIGTERM")
    const timer = setTimeout(() => kill("SIGKILL"), 1500)
    timer.unref()
    this.child.once("close", () => clearTimeout(timer))
  }
}
