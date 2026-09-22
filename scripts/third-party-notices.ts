import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
const packages = new Map<string, string>()
for (const entry of await readdir("node_modules/.bun")) {
  const root = join("node_modules/.bun", entry, "node_modules")
  const names = await readdir(root).catch(() => [] as string[])
  const dirs = (
    await Promise.all(
      names.map(async (name) =>
        name.startsWith("@")
          ? (await readdir(join(root, name))).map((child) => join(root, name, child))
          : [join(root, name)],
      ),
    )
  ).flat()
  for (const dir of dirs) {
    const pkg = await readFile(join(dir, "package.json"), "utf8")
      .then((text) => JSON.parse(text))
      .catch(() => undefined)
    if (!pkg?.name || !pkg.version) continue
    const key = `${pkg.name}@${pkg.version}`
    if (packages.has(key)) continue
    const files = (await readdir(dir)).filter((file) => /^(license|licence|copying|notice)(\.|$|-)/i.test(file))
    const notices = (await Promise.all(files.map((file) => readFile(join(dir, file), "utf8").catch(() => "")))).filter(
      Boolean,
    )
    if (!notices.length) continue
    packages.set(key, `## ${key}\n\n${notices.join("\n\n")}\n`)
  }
}
await Bun.write(
  "packages/desktop/resources/THIRD-PARTY-NOTICES.txt",
  `Third-party notices\n\nCodeInk includes open-source software. This inventory includes build dependencies as well as runtime dependencies; inclusion does not imply that every package ships in the application. Electron's own notices are distributed alongside its runtime. Agent runtimes are not bundled.\n\n${[
    ...packages.entries(),
  ]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => value)
    .join("\n")}\n`,
)
console.log(`Collected ${packages.size} package license notices`)
