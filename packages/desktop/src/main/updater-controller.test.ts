import { describe, expect, test } from "bun:test"
import { createUpdaterController } from "./updater-controller"

describe("updater controller", () => {
  test("downloads an available update in the app and installs it when asked", async () => {
    const calls: string[] = []
    let finishDownload = () => {}
    const controller = createUpdaterController({
      enabled: true,
      currentVersion: "0.1.14",
      checkForUpdates: async () => {
        calls.push("check")
        return "0.1.15"
      },
      downloadUpdate: () => new Promise<void>((resolve) => {
        calls.push("download")
        finishDownload = resolve
      }),
      installUpdate: () => calls.push("install"),
    })
    const states: string[] = []
    controller.subscribe((state) => states.push(state.status))

    await controller.start()
    expect(controller.getState()).toEqual({ status: "downloading", version: "0.1.15" })
    finishDownload()
    await Bun.sleep(0)
    await controller.check()
    controller.install()
    await Bun.sleep(0)

    expect(states).toEqual(["idle", "checking", "downloading", "ready", "installing"])
    expect(controller.getState()).toEqual({ status: "installing", version: "0.1.15" })
    expect(calls).toEqual(["check", "download", "install"])
  })

  test("reports a failed in-app download and allows another check", async () => {
    let checks = 0
    const controller = createUpdaterController({
      enabled: true,
      currentVersion: "0.1.14",
      checkForUpdates: async () => {
        checks++
        return "0.1.15"
      },
      downloadUpdate: async () => { throw new Error("Download failed") },
      installUpdate() {},
    })

    await controller.check()
    await Bun.sleep(0)
    expect(controller.getState()).toEqual({ status: "error", message: "Download failed" })
    await controller.check()
    expect(checks).toBe(2)
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
