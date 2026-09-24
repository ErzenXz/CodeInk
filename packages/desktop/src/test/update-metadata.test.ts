import { expect, test } from "bun:test"
import { parseUpdateInfo } from "electron-updater/out/providers/Provider.js"
import { updateMetadata } from "../../../../scripts/update-metadata"

const assets = [
  { name: "codeink-production-0.1.36-mac-arm64.zip", sha512: "arm-hash", size: 12 },
  { name: "codeink-production-0.1.36-mac-x64.zip", sha512: "intel-hash", size: 34 },
  { name: "codeink-production-0.1.36-win-x64.exe", sha512: "windows-hash", size: 56 },
  { name: "codeink-production-0.1.36-linux-x64.AppImage", sha512: "linux-hash", size: 78 },
  { name: "codeink-production-0.1.36-linux-arm64.AppImage", sha512: "linux-arm-hash", size: 90 },
]

test("release metadata contains both Mac architectures and the Windows installer", () => {
  const files = updateMetadata("0.1.36", "production", assets, new Date("2026-09-24T12:00:00Z"))
  expect(files.map((file) => file.name)).toEqual(["latest-mac.yml", "latest.yml", "latest-linux.yml", "latest-linux-arm64.yml"])
  expect(files[0].content).toContain("url: codeink-production-0.1.36-mac-arm64.zip\n    sha512: arm-hash\n    size: 12")
  expect(files[0].content).toContain("url: codeink-production-0.1.36-mac-x64.zip\n    sha512: intel-hash\n    size: 34")
  expect(files[1].content).toContain("url: codeink-production-0.1.36-win-x64.exe\n    sha512: windows-hash\n    size: 56")
  expect(files[0].content).toContain("releaseDate: 2026-09-24T12:00:00.000Z")
  const mac = parseUpdateInfo(files[0].content, files[0].name, new URL("https://github.com/ErzenXz/CodeInk/releases/download/v0.1.36/latest-mac.yml"))
  expect(mac.files.map((file) => file.url)).toEqual([
    "codeink-production-0.1.36-mac-arm64.zip",
    "codeink-production-0.1.36-mac-x64.zip",
  ])
  const windows = parseUpdateInfo(files[1].content, files[1].name, new URL("https://github.com/ErzenXz/CodeInk/releases/download/v0.1.36/latest.yml"))
  expect(windows.files[0]).toMatchObject({ url: "codeink-production-0.1.36-win-x64.exe", sha512: "windows-hash", size: 56 })
  expect(files[2].content).toContain("url: codeink-production-0.1.36-linux-x64.AppImage")
  expect(files[3].content).toContain("url: codeink-production-0.1.36-linux-arm64.AppImage")
})

test("early access publishes update metadata on its own channel", () => {
  expect(updateMetadata("0.1.36-early-access", "early-access", assets).map((file) => file.name)).toEqual([
    "early-access-mac.yml",
    "early-access.yml",
    "early-access-linux.yml",
    "early-access-linux-arm64.yml",
  ])
})
