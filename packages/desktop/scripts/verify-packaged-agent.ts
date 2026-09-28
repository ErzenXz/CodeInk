import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const root = resolve(process.argv[2] ?? join(import.meta.dirname, "../dist"))
const directory = root.endsWith(".app")
  ? root
  : process.platform === "darwin"
    ? (
        await Promise.all(
          (await readdir(root, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory() && entry.name.startsWith("mac"))
            .map(async (entry) =>
              (await readdir(join(root, entry.name)))
                .filter((name) => name.endsWith(".app"))
                .map((name) => join(root, entry.name, name)),
            ),
        )
      ).flat()[0]
    : (await readdir(root))
        .filter((name) => name.startsWith(process.platform === "win32" ? "win" : "linux") && name.endsWith("unpacked"))
        .map((name) => join(root, name))[0]
if (!directory) throw new Error("No packaged application found")
const resources = join(directory, process.platform === "darwin" ? "Contents/Resources" : "resources")
const executableFolder = process.platform === "darwin" ? join(directory, "Contents/MacOS") : directory
const executable = (await readdir(executableFolder)).find((name) =>
  process.platform === "linux"
    ? /^codeink(?:-early-access)?$/.test(name)
    : /^CodeInk(?: Early Access)?(?:\.exe)?$/.test(name),
)
if (!executable) throw new Error("No packaged executable found")
const temporary = await mkdtemp(join(tmpdir(), "codeink-packaged-smoke-"))
try {
  const result = await Bun.build({
    entrypoints: [join(import.meta.dirname, "../src/test/packaged-agent.ts")],
    target: "node",
    format: "cjs",
    outdir: temporary,
    external: ["ai", "@ai-sdk/openai-compatible", "zod"],
  })
  if (!result.success) throw new AggregateError(result.logs, "Could not build packaged agent check")
  // Resolve the adapter's deferred SDK imports inside the actual installer,
  // never through the source checkout's development node_modules.
  await Bun.write(
    result.outputs[0].path,
    ["ai", "@ai-sdk/openai-compatible", "zod"].reduce(
      (source, name) => {
        const original = `import("${name}")`
        if (!source.includes(original)) throw new Error(`Missing deferred SDK import: ${name}`)
        return source.replaceAll(
          original,
          `import(${JSON.stringify(pathToFileURL(join(resources, "app.asar/node_modules", name, name === "zod" ? "index.js" : "dist/index.js")).href)})`,
        )
      },
      await result.outputs[0].text(),
    ),
  )
  const child = Bun.spawn([join(executableFolder, executable), result.outputs[0].path], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdout: "inherit",
    stderr: "inherit",
  })
  const timeout = setTimeout(() => child.kill(), 60_000)
  const status = await child.exited.finally(() => clearTimeout(timeout))
  if (status !== 0) throw new Error(`Packaged agent check failed (${status})`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
