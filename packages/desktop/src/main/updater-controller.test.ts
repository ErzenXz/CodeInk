import { describe, expect, test } from "bun:test"
import { createUpdaterController } from "./updater-controller"

describe("updater controller", () => {
  test("reports a newer CodeInk release and opens its download page", async () => {
    const calls: string[] = []
    const controller = createUpdaterController({
      enabled: true,
      currentVersion: "0.1.14",
      checkForUpdates: async () => {
        calls.push("check")
        return "0.1.15"
      },
      openDownload: () => calls.push("open"),
    })
    const states: string[] = []
    controller.subscribe((state) => states.push(state.status))

    await controller.start()
    controller.openDownload()

    expect(states).toEqual(["idle", "checking", "available"])
    expect(controller.getState()).toEqual({ status: "available", version: "0.1.15" })
    expect(calls).toEqual(["check", "open"])
  })

  test("does not offer older releases or another download after they are current", async () => {
    const calls: string[] = []
    const controller = createUpdaterController({
      enabled: true,
      currentVersion: "0.1.15-early-access",
      checkForUpdates: async () => "0.1.14-early-access",
      openDownload: () => calls.push("open"),
    })

    await controller.check()
    controller.openDownload()

    expect(controller.getState()).toEqual({ status: "up-to-date" })
    expect(calls).toEqual([])
  })

  test("coalesces concurrent checks and exposes a failed request", async () => {
    let checks = 0
    const controller = createUpdaterController({
      enabled: true,
      currentVersion: "0.1.14",
      checkForUpdates: async () => {
        checks++
        throw new Error("GitHub responded with 403")
      },
      openDownload() {},
    })

    await Promise.all([controller.check(), controller.check(), controller.check()])

    expect(checks).toBe(1)
    expect(controller.getState()).toEqual({ status: "error", message: "GitHub responded with 403" })
  })
})
