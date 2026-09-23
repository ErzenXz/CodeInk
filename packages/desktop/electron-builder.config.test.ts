import { expect, test } from "bun:test"
import type { Configuration } from "electron-builder"

for (const channel of ["early-access", "production"] as const) {
  test(`builds CodeInk ${channel} without bundling an agent CLI`, async () => {
    const previous = process.env.CODEINK_CHANNEL
    process.env.CODEINK_CHANNEL = channel

    const module = await import(`./electron-builder.config.ts?channel=${channel}`)
    const config = module.default as Configuration

    if (previous === undefined) delete process.env.CODEINK_CHANNEL
    else process.env.CODEINK_CHANNEL = previous

    const early = channel === "early-access"
    expect(config.appId).toBe(early ? "app.codeink.desktop.early-access" : "app.codeink.desktop")
    expect(config.productName).toBe(early ? "CodeInk Early Access" : "CodeInk")
    expect(config.linux?.executableName).toBe(early ? "codeink-early-access" : "codeink")
    expect(config.files).not.toContain(expect.stringContaining("opencode-cli"))
    expect(config.extraResources).not.toContainEqual(expect.objectContaining({ filter: ["opencode-cli*"] }))
  })
}
