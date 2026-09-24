// Lists the latest GitHub release for each channel on the download page.
const repo = "ErzenXz/CodeInk"
const releasesPage = `https://github.com/${repo}/releases`
const tabs = [...document.querySelectorAll("[data-channel]")]
const status = document.querySelector("#release-status")
const note = document.querySelector("#channel-note")
const panel = document.querySelector("#release-panel")
const notes = document.querySelector("#release-notes")
const checksums = document.querySelector("#release-checksums")
const slots = document.querySelectorAll(".download-links")
const assets = [
  ["mac", "mac-arm64.dmg", "Apple Silicon"],
  ["mac", "mac-x64.dmg", "Intel"],
  ["win", "win-x64.exe", "Windows x64"],
  ["linux", "linux-x64.AppImage", "AppImage · x64"],
  ["linux", "linux-arm64.AppImage", "AppImage · ARM64"],
  ["linux", "linux-x64.deb", "Debian · x64"],
  ["linux", "linux-arm64.deb", "Debian · ARM64"],
]
const channels = {
  production: {
    label: "Production",
    note: "Stable builds from the main branch.",
    match: (release) => !release.prerelease && !release.tag_name.includes("-early-access"),
  },
  "early-access": {
    label: "Early Access",
    note: "Newest changes from development. Installs separately as CodeInk Early Access, with its own session data.",
    match: (release) => release.prerelease && release.tag_name.includes("-early-access"),
  },
}
let request
let catalog

async function load(channel) {
  history.replaceState(null, "", channel === "early-access" ? "#early-access" : location.pathname + location.search)
  request?.abort()
  const controller = new AbortController()
  request = controller
  const config = channels[channel]
  tabs.forEach((tab) => {
    const selected = tab.dataset.channel === channel
    tab.setAttribute("aria-selected", String(selected))
    tab.tabIndex = selected ? 0 : -1
    if (selected) panel.setAttribute("aria-labelledby", tab.id)
  })
  note.textContent = config.note
  notes.href = releasesPage
  notes.textContent = "All releases and checksums"
  checksums.hidden = true
  if (!catalog) {
    panel.setAttribute("aria-busy", "true")
    status.textContent = "Checking GitHub for the latest release…"
    slots.forEach((slot) => slot.replaceChildren(placeholder(), placeholder()))
  }
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    if (!catalog) {
      const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
        signal: controller.signal,
        headers: { Accept: "application/vnd.github+json" },
      })
      if (!response.ok) throw new Error(`GitHub responded with ${response.status}`)
      const releases = await response.json()
      if (!Array.isArray(releases)) throw new Error("Unexpected release list")
      catalog = releases
    }
    if (request !== controller) return
    const release = catalog
      .filter((release) => !release.draft && config.match(release))
      .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0]
    panel.removeAttribute("aria-busy")
    if (!release) {
      status.textContent = `No ${config.label} build has been published yet. Follow progress on GitHub Releases.`
      slots.forEach((slot) => slot.replaceChildren(message("No build yet for this channel.")))
      return
    }
    status.replaceChildren(
      strong(release.name || release.tag_name),
      ` · ${new Date(release.published_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`,
    )
    if (release.html_url?.startsWith(`${releasesPage}/`)) notes.href = release.html_url
    notes.textContent = "Release notes"
    const sums = (release.assets ?? []).find((asset) => asset.name === "SHA256SUMS.txt")
    if (isReleaseDownload(sums?.browser_download_url)) {
      checksums.href = sums.browser_download_url
      checksums.hidden = false
    }
    slots.forEach((slot) => slot.replaceChildren())
    assets.forEach(([platform, suffix, label]) => {
      // Older macOS assets predate the signed-and-notarized release gate.
      if (platform === "mac" && !hasSignedMacBuild(release.tag_name, channel)) return
      const asset = (release.assets ?? []).find((asset) => normalize(asset.name).endsWith(suffix.toLowerCase()))
      if (!isReleaseDownload(asset?.browser_download_url)) return
      const link = document.createElement("a")
      link.className = "download"
      link.href = asset.browser_download_url
      link.setAttribute(
        "aria-label",
        `Download ${config.label} for ${label}${asset.size ? `, ${size(asset.size)}` : ""}`,
      )
      link.append(
        Object.assign(document.createElement("span"), { className: "download-label", textContent: label }),
        Object.assign(document.createElement("span"), {
          className: "download-meta",
          textContent: [suffix.split(".").pop(), asset.size && size(asset.size)].filter(Boolean).join(" · "),
        }),
      )
      document.querySelector(`[data-platform="${platform}"]`).append(link)
    })
    slots.forEach((slot) => {
      if (!slot.children.length)
        slot.append(
          message(
            slot.dataset.platform === "mac" && !hasSignedMacBuild(release.tag_name, channel)
              ? "This release predates Apple signing. A signed macOS build is coming."
              : "Not included in this release.",
          ),
        )
    })
  } catch {
    if (request !== controller) return
    panel.removeAttribute("aria-busy")
    status.textContent = "Couldn’t reach GitHub to list downloads. Download directly from GitHub Releases instead."
    slots.forEach((slot) => {
      const link = document.createElement("a")
      link.className = "download download-fallback"
      link.href = releasesPage
      link.append(
        Object.assign(document.createElement("span"), {
          className: "download-label",
          textContent: "Open GitHub Releases",
        }),
      )
      const retry = document.createElement("button")
      retry.type = "button"
      retry.className = "retry"
      retry.textContent = "Try again"
      retry.addEventListener("click", () => {
        // The button is about to be replaced, so keep focus in the panel rather than dropping it to the page.
        panel.focus()
        load(tabs.find((tab) => tab.getAttribute("aria-selected") === "true").dataset.channel)
      })
      slot.replaceChildren(link, retry)
    })
  } finally {
    clearTimeout(timeout)
  }
}

tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => {
    if (tab.getAttribute("aria-selected") !== "true") load(tab.dataset.channel)
  })
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    const target =
      event.key === "Home"
        ? tabs[0]
        : event.key === "End"
          ? tabs.at(-1)
          : tabs[(index + (event.key === "ArrowLeft" ? tabs.length - 1 : 1)) % tabs.length]
    target.focus()
    if (target.getAttribute("aria-selected") !== "true") load(target.dataset.channel)
  })
})

load(location.hash === "#early-access" ? "early-access" : "production")
window.addEventListener("hashchange", () => load(location.hash === "#early-access" ? "early-access" : "production"))

// Match electron-builder's native Linux arch names too, as the release script does.
function normalize(name) {
  return name
    .toLowerCase()
    .replace(/-linux-(x86_64|amd64)\./, "-linux-x64.")
    .replace(/-linux-aarch64\./, "-linux-arm64.")
}

function isReleaseDownload(url) {
  return typeof url === "string" && url.startsWith(`${releasesPage}/download/`)
}

function hasSignedMacBuild(tag, channel) {
  const version = /^v(\d+)\.(\d+)\.(\d+)(?:-early-access)?$/.exec(tag)
  if (!version) return false
  const [major, minor, patch] = version.slice(1).map(Number)
  if (major !== 0 || minor !== 1) return true
  return patch > (channel === "early-access" ? 15 : 16)
}

function size(bytes) {
  return `${Math.max(1, Math.round(bytes / 1048576))} MB`
}

function placeholder() {
  const node = Object.assign(document.createElement("span"), { className: "download-placeholder" })
  node.setAttribute("aria-hidden", "true")
  return node
}

function message(text) {
  return Object.assign(document.createElement("p"), { className: "download-empty", textContent: text })
}

function strong(text) {
  return Object.assign(document.createElement("strong"), { textContent: text })
}
