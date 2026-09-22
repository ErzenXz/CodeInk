import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WebSocket } from "ws"
import { startBridge } from "../main/bridge"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"

const cleanup: (() => Promise<void>)[] = []
try {
  const directory = await mkdtemp(join(tmpdir(), "codeink-terminal-"))
  const bridge = await startBridge("127.0.0.1", 0, "terminal-test", directory, {
    ...process.env,
    CODEINK_TERMINAL_TEST: "verified",
  })
  cleanup.push(async () => {
    await bridge.stop()
    await rm(directory, { recursive: true, force: true })
  })
  const address = bridge.server.address()
  if (!address || typeof address === "string") throw new Error("No listener")
  const baseUrl = `http://127.0.0.1:${address.port}`
  const client = createOpencodeClient({
    baseUrl,
    directory,
    headers: { Authorization: `Basic ${Buffer.from("opencode:terminal-test").toString("base64")}` },
    throwOnError: true,
  })
  const terminal = (
    await client.pty.create({
      command: process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : "/bin/sh",
      args: [],
      directory,
    })
  ).data!
  const ticket = (await client.pty.connectToken({ ptyID: terminal.id, directory })).data!.ticket
  const url = `${baseUrl.replace("http:", "ws:")}/pty/${terminal.id}/connect?ticket=${ticket}`
  const socket = new WebSocket(url)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("No terminal output")), 5000)
    let output = ""
    socket.once("error", reject)
    socket.once("open", () =>
      socket.send(
        process.platform === "win32" ? "echo terminal-%CODEINK_TERMINAL_TEST%\r" : "printf 'terminal-%s\\n' verified\r",
      ),
    )
    socket.on("message", (data, binary) => {
      if (binary) return
      output += data.toString()
      if (!output.includes("terminal-verified")) return
      clearTimeout(timer)
      resolve()
    })
  })
  const replay = new WebSocket(url)
  assert.equal(
    await new Promise<boolean>((resolve) => {
      replay.once("error", () => resolve(true))
      replay.once("open", () => {
        replay.close()
        resolve(false)
      })
    }),
    true,
  )
  socket.close()
  await client.pty.remove({ ptyID: terminal.id, directory })
  assert.deepEqual((await client.pty.list({ directory })).data, [])
} finally {
  for (const fn of cleanup) await fn()
}
console.log("Native terminal create, stream, single-use token and cleanup passed.")
