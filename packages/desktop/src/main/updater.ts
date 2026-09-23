import { app, dialog } from "electron"
import { CHANNEL, UPDATER_ENABLED } from "./constants"
import { createUpdaterController } from "./updater-controller"
import { checkCodeInkRelease, downloadURL } from "./release-update"
import { getLogger } from "./logging"
import { openExternalURL } from "./windows"
import { nativeT } from "./native-translations"

export function setupUpdater() {
  const logger = getLogger()
  return createUpdaterController({
    enabled: UPDATER_ENABLED,
    currentVersion: app.getVersion(),
    checkForUpdates: () => checkCodeInkRelease(CHANNEL),
    openDownload: () => openExternalURL(downloadURL(CHANNEL)),
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
