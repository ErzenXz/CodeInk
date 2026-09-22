const repo = "ErzenXz/CodeInk"
const tabs = [...document.querySelectorAll("[data-channel]")]
const status = document.querySelector("#release-status")
const note = document.querySelector("#channel-note")
const panel = document.querySelector("#release-panel")
const notes = document.querySelector("#release-notes")
let request
const labels = [
  ["mac", "mac-arm64.dmg", "Apple Silicon ↓"],
  ["mac", "mac-x64.dmg", "Intel ↓"],
  ["win", "win-x64.exe", "Download installer ↓"],
  ["linux", "linux-x64.AppImage", "AppImage · x64 ↓"],
  ["linux", "linux-arm64.AppImage", "AppImage · ARM64 ↓"],
  ["linux", "linux-x64.deb", "Debian · x64 ↓"],
  ["linux", "linux-arm64.deb", "Debian · ARM64 ↓"],
]
async function load(channel) {
  request?.abort()
  const controller = new AbortController()
  request = controller
  tabs.forEach((tab) => {
    const selected = tab.dataset.channel === channel
    tab.setAttribute("aria-selected", String(selected))
    tab.tabIndex = selected ? 0 : -1
    if (selected) panel.setAttribute("aria-labelledby", tab.id)
  })
  note.textContent =
    channel === "production"
      ? "The production release, built from main."
      : "The newest work from development. Installs separately as CodeInk Early Access."
  status.textContent = "Checking for the latest release…"
  document.querySelectorAll(".download-links").forEach((element) => element.replaceChildren())
  notes.href = `https://github.com/${repo}/releases`
  notes.textContent = "All releases & checksums ↗"
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github+json" },
    })
    if (!response.ok) throw new Error("Release catalog unavailable")
    const releases = await response.json()
    const release = releases
      .filter(
        (release) =>
          !release.draft &&
          (channel === "early-access"
            ? release.prerelease && release.tag_name.includes("-early-access")
            : !release.prerelease),
      )
      .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0]
    if (!release) {
      status.textContent = "The first build for this channel is being prepared. Check GitHub Releases for progress."
      return
    }
    status.textContent = `${release.name} · ${new Date(release.published_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`
    if (release.html_url.startsWith(`https://github.com/${repo}/releases/`)) notes.href = release.html_url
    notes.textContent = "Release notes & checksums ↗"
    for (const [platform, suffix, label] of labels) {
      const asset = release.assets.find((asset) => asset.name.endsWith(suffix))
      if (!asset?.browser_download_url.startsWith(`https://github.com/${repo}/releases/download/`)) continue
      const link = document.createElement("a")
      link.href = asset.browser_download_url
      link.textContent = label
      link.setAttribute(
        "aria-label",
        `${channel === "early-access" ? "Early Access" : "Production"}: ${label.replace(" ↓", "")}`,
      )
      document.querySelector(`[data-platform="${platform}"]`).append(link)
    }
    document.querySelectorAll(".download-links").forEach((element) => {
      if (!element.children.length) {
        const text = document.createElement("p")
        text.textContent = "Not available in this release."
        element.append(text)
      }
    })
  } catch (error) {
    if (controller.signal.aborted) return
    status.textContent = "Couldn’t load downloads. Use All releases & checksums to download directly from GitHub."
  }
}
tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => load(tab.dataset.channel))
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    const target = event.key === "Home" ? tabs[0] : event.key === "End" ? tabs.at(-1) : tabs[(index + 1) % tabs.length]
    target.focus()
    load(target.dataset.channel)
  })
})
load("production")
