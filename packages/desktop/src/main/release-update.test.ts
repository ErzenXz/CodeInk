import { describe, expect, test } from "bun:test"
import { selectLatestRelease } from "./release-update"

describe("CodeInk release updates", () => {
  const releases = [
    { tag_name: "v0.1.14", draft: false, prerelease: false },
    { tag_name: "v0.1.13-early-access", draft: false, prerelease: true },
    { tag_name: "v0.1.16-early-access", draft: true, prerelease: true },
    { tag_name: "v0.1.15-early-access", draft: false, prerelease: true },
    { tag_name: "v1.20.0", draft: false, prerelease: false },
    { tag_name: "v0.1.99", draft: true, prerelease: false },
  ]

  test("selects only the latest published release for each CodeInk channel", () => {
    expect(selectLatestRelease(releases, "prod")).toBe("1.20.0")
    expect(selectLatestRelease(releases, "beta")).toBe("0.1.15-early-access")
  })

  test("rejects an invalid response instead of reporting up to date", () => {
    expect(() => selectLatestRelease({ message: "rate limit exceeded" }, "prod")).toThrow()
    expect(() => selectLatestRelease([], "prod")).toThrow()
  })
})
