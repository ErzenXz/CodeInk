// Shared behavior for every page: theme switch, header border, mobile menu, OS-aware download labels and reveal-on-scroll.

const root = document.documentElement
const storageKey = "codeink-site-theme"

const themeButtons = [...document.querySelectorAll("[data-theme-choice]")]
const themeColors = [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) => [meta, meta.content])
const applyTheme = (choice) => {
  if (choice === "light" || choice === "dark") root.dataset.theme = choice
  if (choice === "system") delete root.dataset.theme
  // Keep the browser toolbar in step with a manual theme instead of the system one.
  themeColors.forEach(([meta, color]) => {
    meta.content = choice === "light" ? "#ffffff" : choice === "dark" ? "#0a0a0b" : color
  })
  themeButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.themeChoice === choice)))
}
applyTheme(readTheme())
window.addEventListener("storage", (event) => {
  if (event.key === storageKey || event.key === null) applyTheme(readTheme())
})
themeButtons.forEach((button) =>
  button.addEventListener("click", () => {
    const choice = button.dataset.themeChoice
    try {
      if (choice === "system") localStorage.removeItem(storageKey)
      if (choice !== "system") localStorage.setItem(storageKey, choice)
    } catch {}
    applyTheme(choice)
  }),
)

const header = document.querySelector(".site-header")
const onScroll = () => header?.classList.toggle("is-scrolled", window.scrollY > 8)
onScroll()
window.addEventListener("scroll", onScroll, { passive: true })

// Close the mobile menu after picking a link, so in-page anchors don't leave it covering the content.
const menu = document.querySelector(".menu")
menu?.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => menu.removeAttribute("open")))
// Like other popovers, Escape or a tap elsewhere dismisses it.
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !menu?.open) return
  menu.removeAttribute("open")
  menu.querySelector("summary").focus()
})
document.addEventListener("click", (event) => {
  if (menu?.open && !menu.contains(event.target)) menu.removeAttribute("open")
})

const os = detectOS()
if (os) {
  const name = { mac: "macOS", win: "Windows", linux: "Linux" }[os]
  document.querySelectorAll("[data-download-label]").forEach((node) => (node.textContent = `Download for ${name}`))
  document.querySelector(`.platform[data-os="${os}"]`)?.classList.add("is-current")
}

const reveals = document.querySelectorAll(".reveal")
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        entry.target.classList.add("is-visible")
        observer.unobserve(entry.target)
      }),
    { rootMargin: "0px 0px -8% 0px" },
  )
  reveals.forEach((node) => observer.observe(node))
}
if (!("IntersectionObserver" in window)) reveals.forEach((node) => node.classList.add("is-visible"))

function readTheme() {
  try {
    const theme = localStorage.getItem(storageKey)
    return theme === "light" || theme === "dark" ? theme : "system"
  } catch {
    return "system"
  }
}

function detectOS() {
  const platform = `${navigator.userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent}`
  if (/android|iphone|ipad/i.test(platform)) return
  // iPadOS reports itself as a Mac; only a real Mac has no multi-touch screen.
  if (/mac/i.test(platform) && navigator.maxTouchPoints > 1) return
  if (/mac/i.test(platform)) return "mac"
  if (/win/i.test(platform)) return "win"
  if (/linux|x11/i.test(platform)) return "linux"
}
