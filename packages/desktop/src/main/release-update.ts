import type { CHANNEL } from "./constants"

type Channel = typeof CHANNEL
const releasesURL = "https://api.github.com/repos/ErzenXz/CodeInk/releases?per_page=100"
export const downloadURL = (channel: Channel) =>
  `https://www.getcode.ink/download.html${channel === "beta" ? "#early-access" : ""}`

export function selectLatestRelease(value: unknown, channel: Channel) {
  if (!Array.isArray(value)) throw new Error("Invalid CodeInk release response")
  const releases = value
    .filter(
      (release): release is { tag_name: string; draft: boolean; prerelease: boolean } =>
        release !== null &&
        typeof release === "object" &&
        typeof release.tag_name === "string" &&
        release.draft === false &&
        release.prerelease === (channel === "beta") &&
        /^v\d+\.\d+\.\d+(-early-access)?$/.test(release.tag_name) &&
        release.tag_name.endsWith("-early-access") === (channel === "beta"),
    )
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name))
  if (!releases[0]) throw new Error("No CodeInk release is available for this channel")
  return releases[0].tag_name.slice(1)
}

export function isNewerRelease(latest: string, current: string) {
  return compareVersions(latest, current) > 0
}

function compareVersions(a: string, b: string) {
  const numbers = (version: string) => version.replace(/^v/, "").split("-")[0].split(".").map(Number)
  const left = numbers(a)
  const right = numbers(b)
  return (left[0] - right[0]) || (left[1] - right[1]) || (left[2] - right[2])
}

export async function checkCodeInkRelease(channel: Channel) {
  const response = await fetch(releasesURL, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "CodeInk" },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`CodeInk release check failed (${response.status})`)
  return selectLatestRelease(await response.json(), channel)
}
