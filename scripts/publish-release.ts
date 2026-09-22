import { createHash } from "node:crypto"
import { readdir } from "node:fs/promises"
const {
  RELEASE_TAG: tag,
  RELEASE_CHANNEL: channel,
  RELEASE_VERSION: version,
  GH_REPO: repo,
  GITHUB_SHA: commit,
} = process.env
if (!tag || !version || !repo || !commit || !["production", "early-access"].includes(channel ?? ""))
  throw new Error("Missing release metadata")
const files = (await readdir("release")).filter((file) => /\.(dmg|zip|exe|AppImage|deb)$/.test(file)).sort()
// Never publish a partial matrix as a complete release.
for (const target of [
  "mac-arm64.dmg",
  "mac-x64.dmg",
  "win-x64.exe",
  "linux-x64.AppImage",
  "linux-arm64.AppImage",
  "linux-x64.deb",
  "linux-arm64.deb",
])
  if (!files.some((file) => file.endsWith(target))) throw new Error(`Missing ${target}`)
const assets = await Promise.all(
  files.map(async (name) => ({
    name,
    sha256: createHash("sha256")
      .update(Buffer.from(await Bun.file(`release/${name}`).arrayBuffer()))
      .digest("hex"),
    size: Bun.file(`release/${name}`).size,
  })),
)
await Bun.write("release/SHA256SUMS.txt", assets.map((file) => `${file.sha256}  ${file.name}`).join("\n") + "\n")
await Bun.write("release/manifest.json", JSON.stringify({ version, channel, commit, assets }, null, 2))
const title = `CodeInk ${channel === "early-access" ? "Early Access " : ""}${version}`
await Bun.write(
  "release/notes.md",
  `${title}\n\nBuilt from ${commit}. Install your coding agents separately and sign in using their CLIs.\n\nDownloads: macOS (Apple Silicon and Intel), Windows (x64), Linux (x64 and ARM64; AppImage and Debian). SHA-256 checksums are attached.\n\nThese initial builds are unsigned unless this build was configured with platform signing credentials. macOS may require approval in Privacy & Security; Windows may show SmartScreen.\n\n${channel === "early-access" ? "Early Access installs separately from production and uses a separate data folder. It contains changes from development." : "Production channel, built from main."}\n\nCreated by Erzen Krasniqi. MIT licensed; upstream attribution is included in the app.\n`,
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
  "--clobber",
])
await gh(["release", "edit", tag, "--draft=false", `--latest=${channel === "production" ? "true" : "false"}`])
