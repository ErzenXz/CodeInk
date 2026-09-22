import { appendFile } from "node:fs/promises"
const branch = process.env.GITHUB_REF_NAME
if (branch !== "main" && branch !== "development") throw new Error("Releases require main or development")
const base = (await Bun.file("package.json").json()).version as string
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(base)
const run = Number(process.env.GITHUB_RUN_NUMBER)
if (!match || !Number.isSafeInteger(run) || run < 1) throw new Error("Invalid release version")
const channel = branch === "main" ? "production" : "early-access"
const version = `${match[1]}.${match[2]}.${Number(match[3]) + run}${channel === "early-access" ? "-early-access" : ""}`
const pkg = await Bun.file("packages/desktop/package.json").json()
await Bun.write("packages/desktop/package.json", JSON.stringify({ ...pkg, version }, null, 2) + "\n")
if (process.env.GITHUB_OUTPUT)
  await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\nchannel=${channel}\ntag=v${version}\n`)
console.log(`${channel}: ${version}`)
