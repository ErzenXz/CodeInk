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

// Illustration only: swap which agent the sample workspace shows.
const chips = [...document.querySelectorAll(".agent-chip")]
chips.forEach((chip) =>
  chip.addEventListener("click", () => {
    chips.forEach((other) => other.setAttribute("aria-pressed", String(other === chip)))
    document.querySelectorAll('[data-slot="name"]').forEach((node) => (node.textContent = chip.dataset.name))
    document.querySelectorAll('[data-slot="command"]').forEach((node) => (node.textContent = chip.dataset.command))
    document.querySelectorAll('[data-slot="protocol"]').forEach((node) => (node.textContent = chip.dataset.protocol))
    document
      .querySelectorAll('[data-slot="icon"]')
      .forEach((node) => node.setAttribute("href", `agents.svg#${chip.dataset.agent}`))
    const stage = document.querySelector(".window")
    stage.classList.remove("is-switching")
    void stage.offsetWidth
    stage.classList.add("is-switching")
  }),
)

const os = detectOS()
if (os) {
  document.querySelector(`.platform[data-os="${os}"]`)?.classList.add("is-current")
  document.querySelector("#hero-download").textContent =
    `Download for ${{ mac: "macOS", win: "Windows", linux: "Linux" }[os]}`
}

async function load(channel) {
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
      const asset = (release.assets ?? []).find((asset) => normalize(asset.name).endsWith(suffix.toLowerCase()))
      if (!isReleaseDownload(asset?.browser_download_url)) return
      const link = document.createElement("a")
      link.className = "download"
      link.href = asset.browser_download_url
      link.setAttribute("aria-label", `Download ${config.label} for ${label}${asset.size ? `, ${size(asset.size)}` : ""}`)
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
      if (!slot.children.length) slot.append(message("Not included in this release."))
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
        Object.assign(document.createElement("span"), { className: "download-label", textContent: "Open GitHub Releases" }),
      )
      const retry = document.createElement("button")
      retry.type = "button"
      retry.className = "retry"
      retry.textContent = "Try again"
      retry.addEventListener("click", () => load(tabs.find((tab) => tab.getAttribute("aria-selected") === "true").dataset.channel))
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

load("production")

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

function detectOS() {
  const platform = `${navigator.userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent}`
  if (/android|iphone|ipad/i.test(platform)) return
  if (/mac/i.test(platform)) return "mac"
  if (/win/i.test(platform)) return "win"
  if (/linux|x11/i.test(platform)) return "linux"
}
