;(function () {
  var key = "codeink-theme-id"
  var previous = localStorage.getItem(key) || localStorage.getItem("opencode-theme-id")
  var themeId =
    previous === "oc-1" || previous === "oc-2"
      ? "codeink"
      : previous === "opencode"
        ? "codeink-classic"
        : previous || "codeink"
  localStorage.setItem(key, themeId)
  localStorage.removeItem("opencode-theme-id")

  var scheme = localStorage.getItem("codeink-color-scheme") || localStorage.getItem("opencode-color-scheme") || "system"
  localStorage.setItem("codeink-color-scheme", scheme)
  localStorage.removeItem("opencode-color-scheme")
  var isDark = scheme === "dark" || (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  var mode = isDark ? "dark" : "light"

  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode
  document.documentElement.style.backgroundColor = isDark ? "#080808" : "#fafafa"

  // Update theme-color meta tag to match app color scheme
  var metas = document.querySelectorAll("meta[name='theme-color']")
  if (metas.length > 0) metas[0].setAttribute("content", isDark ? "#080808" : "#fafafa")

  if (themeId === "codeink") {
    localStorage.removeItem("codeink-theme-css-light")
    localStorage.removeItem("codeink-theme-css-dark")
    localStorage.removeItem("opencode-theme-css-light")
    localStorage.removeItem("opencode-theme-css-dark")
    return
  }

  var css = localStorage.getItem("codeink-theme-css-" + mode) || localStorage.getItem("opencode-theme-css-" + mode)
  if (css) localStorage.setItem("codeink-theme-css-" + mode, css)
  localStorage.removeItem("opencode-theme-css-light")
  localStorage.removeItem("opencode-theme-css-dark")
  if (css) {
    var style = document.createElement("style")
    style.id = "codeink-theme-preload"
    style.textContent =
      ":root{color-scheme:" +
      mode +
      ";--text-mix-blend-mode:" +
      (isDark ? "plus-lighter" : "multiply") +
      ";" +
      css +
      "}"
    document.head.appendChild(style)
  }
})()
