import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("drafts and referenced attachments survive a native SQLite restart", async () => {
  // Electron uses Node's SQLite module, which Bun does not implement.
  const directory = await mkdtemp(join(tmpdir(), "codeink-draft-test-"))
  try {
    const build = await Bun.build({
      entrypoints: [join(import.meta.dir, "../test/fixtures/draft-store.ts")],
      outdir: directory,
      target: "node",
    })
    expect(build.success).toBe(true)
    const child = Bun.spawn(["node", join(directory, "draft-store.js"), directory], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect({ code, error: code ? stderr : "" }).toEqual({ code: 0, error: "" })
    expect(stdout.trim()).toBe("Draft persistence and attachment recovery passed")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
