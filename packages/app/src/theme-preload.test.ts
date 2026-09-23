import { beforeEach, describe, expect, test } from "bun:test"

const src = await Bun.file(new URL("../public/codeink-theme-preload.js", import.meta.url)).text()

const run = () => Function(src)()

beforeEach(() => {
  document.head.innerHTML = ""
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.removeAttribute("data-color-scheme")
  localStorage.clear()
  Object.defineProperty(window, "matchMedia", {
    value: () =>
      ({
        matches: false,
      }) as MediaQueryList,
    configurable: true,
  })
})

describe("theme preload", () => {
  test("migrates legacy default theme settings before mount", () => {
    localStorage.setItem("opencode-theme-id", "oc-1")
    localStorage.setItem("opencode-color-scheme", "light")
    localStorage.setItem("opencode-theme-css-light", "--background-base:#fff;")
    localStorage.setItem("opencode-theme-css-dark", "--background-base:#000;")

    run()

    expect(document.documentElement.dataset.theme).toBe("codeink")
    expect(document.documentElement.dataset.colorScheme).toBe("light")
    expect(localStorage.getItem("codeink-theme-id")).toBe("codeink")
    expect(localStorage.getItem("codeink-color-scheme")).toBe("light")
    expect(localStorage.getItem("opencode-theme-id")).toBeNull()
    expect(localStorage.getItem("opencode-theme-css-light")).toBeNull()
    expect(localStorage.getItem("opencode-theme-css-dark")).toBeNull()
    expect(document.getElementById("codeink-theme-preload")).toBeNull()
  })

  test("keeps cached css for non-default themes", () => {
    localStorage.setItem("opencode-theme-id", "nightowl")
    localStorage.setItem("opencode-theme-css-light", "--background-base:#fff;")

    run()

    expect(document.documentElement.dataset.theme).toBe("nightowl")
    expect(localStorage.getItem("codeink-theme-id")).toBe("nightowl")
    expect(localStorage.getItem("codeink-theme-css-light")).toBe("--background-base:#fff;")
    expect(document.getElementById("codeink-theme-preload")?.textContent).toContain("--background-base:#fff;")
  })

  test("migrates the old classic theme ID", () => {
    localStorage.setItem("opencode-theme-id", "opencode")

    run()

    expect(document.documentElement.dataset.theme).toBe("codeink-classic")
    expect(localStorage.getItem("codeink-theme-id")).toBe("codeink-classic")
  })
})
