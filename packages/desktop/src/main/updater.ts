import { app, dialog } from "electron"
import type { AppUpdater } from "electron-updater"
import { CHANNEL, UPDATER_ENABLED } from "./constants"
import { createUpdaterController } from "./updater-controller"
import { checkCodeInkRelease, downloadURL } from "./release-update"
import { getLogger } from "./logging"
import { openExternalURL } from "./windows"
import { nativeT } from "./native-translations"

export function setupUpdater() {
  const logger = getLogger()
  const nativeSupported = UPDATER_ENABLED && (
    process.platform === "darwin" || process.platform === "win32" || (process.platform === "linux" && !!process.env.APPIMAGE)
  )
  let native: Promise<AppUpdater> | undefined
  const getNative = () => native ??= import("electron-updater").then((module) => {
    const updater = module.default.autoUpdater
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = true
    updater.allowPrerelease = CHANNEL === "beta"
    updater.channel = CHANNEL === "beta" ? "early-access" : "latest"
    updater.allowDowngrade = false
    updater.logger = logger
    updater.on("error", (error) => logger.error("native updater failed", error))
    return updater
  })
  return createUpdaterController({
    enabled: UPDATER_ENABLED,
    currentVersion: app.getVersion(),
    checkForUpdates: nativeSupported
      ? async () => (await (await getNative()).checkForUpdates())?.updateInfo.version ?? app.getVersion()
      : () => checkCodeInkRelease(CHANNEL),
    ...(nativeSupported
      ? {
          downloadUpdate: async () => { await (await getNative()).downloadUpdate() },
          installUpdate: async () => { (await getNative()).quitAndInstall() },
        }
      : { openDownload: () => openExternalURL(downloadURL(CHANNEL)) }),
    log: (message, data) => logger.log(message, data),
  })
}

export async function showUpdaterDialog(controller: ReturnType<typeof setupUpdater>, alertOnFail: boolean) {
  const state = await controller.check()
  if (state.status === "error") {
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "error",
      message: nativeT("desktop.updater.dialog.checkFailed.message"),
      title: nativeT("desktop.updater.dialog.checkFailed.title"),
    })
    return
  }
  if (state.status === "up-to-date") {
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "info",
      message: nativeT("desktop.updater.dialog.upToDate.message"),
      title: nativeT("desktop.updater.dialog.upToDate.title"),
    })
    return
  }
  if (state.status === "downloading" || state.status === "installing") {
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "info",
      message: nativeT("desktop.updater.dialog.downloading.message", { version: state.version }),
      title: nativeT("desktop.updater.dialog.downloading.title"),
    })
    return
  }
  if (state.status === "ready") {
    const response = await dialog.showMessageBox({
      type: "info",
      message: nativeT("desktop.updater.dialog.ready.message", { version: state.version }),
      title: nativeT("desktop.updater.dialog.ready.title"),
      buttons: [nativeT("desktop.updater.dialog.restart"), nativeT("desktop.updater.dialog.later")],
      defaultId: 0,
      cancelId: 1,
    })
    if (response.response === 0) controller.install()
    return
  }
  if (state.status !== "available") return

  const response = await dialog.showMessageBox({
    type: "info",
    message: nativeT("desktop.updater.dialog.available.message", { version: state.version }),
    title: nativeT("desktop.updater.dialog.available.title"),
    buttons: [nativeT("desktop.updater.dialog.download"), nativeT("desktop.updater.dialog.later")],
    defaultId: 0,
    cancelId: 1,
  })
  if (response.response === 0) controller.openDownload()
}
