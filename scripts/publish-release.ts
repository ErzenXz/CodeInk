import { createHash } from "node:crypto"
import { readdir, rename } from "node:fs/promises"
import { updateMetadata } from "./update-metadata"
const {
  RELEASE_TAG: tag,
  RELEASE_CHANNEL: channel,
  RELEASE_VERSION: version,
  GH_REPO: repo,
  RELEASE_COMMIT: releaseCommit,
  GITHUB_SHA: workflowCommit,
} = process.env
const commit = releaseCommit ?? workflowCommit
if (!tag || !version || !repo || !commit || !["production", "early-access"].includes(channel ?? ""))
  throw new Error("Missing release metadata")
// electron-builder uses native package architecture names for Linux targets.
for (const name of await readdir("release")) {
  const normalized = name.replace(/-linux-(x86_64|amd64)\./, "-linux-x64.").replace(/-linux-aarch64\./, "-linux-arm64.")
  if (normalized !== name) await rename(`release/${name}`, `release/${normalized}`)
}
const files = (await readdir("release")).filter((file) => /\.(dmg|zip|exe|AppImage|deb)$/.test(file)).sort()
// Never publish a partial matrix as a complete release.
for (const target of [
  "mac-arm64.dmg",
  "mac-x64.dmg",
  "mac-arm64.zip",
  "mac-x64.zip",
  "win-x64.exe",
  "linux-x64.AppImage",
  "linux-arm64.AppImage",
  "linux-x64.deb",
  "linux-arm64.deb",
])
  if (!files.some((file) => file.endsWith(target))) throw new Error(`Missing ${target}`)
const assets = await Promise.all(
  files.map(async (name) => {
    const sha256 = createHash("sha256")
    const sha512 = createHash("sha512")
    for await (const chunk of Bun.file(`release/${name}`).stream()) {
      sha256.update(chunk)
      sha512.update(chunk)
    }
    return { name, sha256: sha256.digest("hex"), sha512: sha512.digest("base64"), size: Bun.file(`release/${name}`).size }
  }),
)
await Bun.write("release/SHA256SUMS.txt", assets.map((file) => `${file.sha256}  ${file.name}`).join("\n") + "\n")
await Bun.write("release/manifest.json", JSON.stringify({ version, channel, commit, assets }, null, 2))
const metadata = updateMetadata(version, channel, assets)
await Promise.all(metadata.map((file) => Bun.write(`release/${file.name}`, file.content)))
const title = `CodeInk ${channel === "early-access" ? "Early Access " : ""}${version}`
const message = Bun.spawnSync(["git", "log", "-1", "--format=%B", commit], { stdout: "pipe", stderr: "pipe" })
if (message.exitCode !== 0) throw new Error("Could not read release commit message")
const highlights = /(?:^|\n)Release notes:\n([\s\S]*)/.exec(new TextDecoder().decode(message.stdout))?.[1]?.trim()
await Bun.write(
  "release/notes.md",
  `${title}\n\n${highlights ? `${highlights}\n\n` : ""}Download for macOS (Apple Silicon or Intel), Windows (x64), or Linux (x64 or ARM64). Checksums are attached. Install and sign in to your coding agents separately.\n\nmacOS builds are signed and notarized by Apple. Windows may show SmartScreen until Windows signing is configured.\n\n${channel === "early-access" ? "Early Access installs beside Production and keeps its own session data." : "This is the Production build."}\n\nBuilt from ${commit}. CodeInk is GPL-3.0-or-later; the incorporated OpenCode code retains its MIT notice.\n`,
)
async function gh(args: string[], allowFailure = false) {
  const result = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "inherit" })
  const output = await new Response(result.stdout).text()
  if ((await result.exited) && !allowFailure) throw new Error(`GitHub operation failed: ${args[0]}`)
  return output
}
const existing = await gh(["release", "view", tag, "--json", "isDraft"], true)
if (existing && !JSON.parse(existing).isDraft)
  throw new Error("A published release is immutable; make a new push to release changes")
const latest = await gh(["release", "view", "--json", "tagName"], true)
const latestVersion = latest ? (JSON.parse(latest).tagName as string).replace(/^v/, "") : undefined
const makeLatest = channel === "production" && (!latestVersion || version.localeCompare(latestVersion, undefined, { numeric: true }) >= 0)
if (!existing)
  await gh([
    "release",
    "create",
    tag,
    "--target",
    commit,
    "--title",
    title,
    "--notes-file",
    "release/notes.md",
    "--draft",
    ...(channel === "early-access" ? ["--prerelease"] : []),
  ])
await gh([
  "release",
  "upload",
  tag,
  ...files.map((file) => `release/${file}`),
  "release/SHA256SUMS.txt",
  "release/manifest.json",
  ...metadata.map((file) => `release/${file.name}`),
  "--clobber",
])
await gh(["release", "edit", tag, "--draft=false", `--latest=${makeLatest}`])
