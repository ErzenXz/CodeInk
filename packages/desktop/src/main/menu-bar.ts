import { app, Menu, nativeImage, Tray } from "electron"
import type { MenuItemConstructorOptions } from "electron"
import { join } from "node:path"
import { nativeDateTime, nativeNumber, nativeT } from "./native-translations"
import { menuBarModel } from "./menu-bar-model"
import { readInstalledAgentUsage, runningAgentSessions, subscribeAgentSessionStatus } from "./server"
import { createMainWindow, getLastFocusedWindow } from "./windows"
import type { AgentUsageReport } from "../shared/types"
import { write as writeLog } from "./logging"
import { subscribeUsageMonitoring, usageMonitoringEnabled } from "./usage-monitoring"

export function startMenuBar() {
  if (process.platform !== "darwin") return
  const icon = nativeImage.createFromPath(
    join(app.isPackaged ? process.resourcesPath : join(import.meta.dirname, "../../resources"), "icons", "32x32.png"),
  )
  const image = icon.resize({ width: 18, height: 18 })
  const tray = new Tray(image)
  tray.setToolTip(nativeT("desktop.menu.app"))
  let reports: AgentUsageReport[] = []
  let runningCount = 0

  const open = (command?: string) => {
    const existing = getLastFocusedWindow()
    const win = existing ?? createMainWindow()
    app.focus({ steal: true })
    if (existing) {
      win.show()
      win.focus()
    }
    if (!command) return
    if (win.webContents.isLoading()) {
      win.webContents.once("did-finish-load", () => win.webContents.send("menu-command", command))
      return
    }
    win.webContents.send("menu-command", command)
  }
  const render = () => {
    const model = menuBarModel(runningAgentSessions(), reports)
    const nextRunningCount = model.running.length + model.moreRunning
    if (nextRunningCount !== runningCount) {
      tray.setTitle(nextRunningCount ? String(nextRunningCount) : "")
      runningCount = nextRunningCount
    }
    const sessionItems: MenuItemConstructorOptions[] = model.running.map((session) => ({
      label: `${session.agent} · ${(session.title || nativeT("desktop.menu.newSession"))
        .replace(/[\x00-\x1f\x7f]+/g, " ")
        .slice(0, 64)}`,
      click: () => open(`tray.session:${Buffer.from(session.directory).toString("base64url")}:${session.id}`),
    }))
    const usageItems: MenuItemConstructorOptions[] = model.usage.map((report) => ({
      label: report.name,
      submenu: [
        ...report.windows.flatMap((window): MenuItemConstructorOptions[] => [
          {
            label: nativeT("desktop.tray.limit", {
              window: nativeT(`desktop.tray.window.${window.kind}`),
              percent: Math.round(Math.max(0, Math.min(100, window.usedPercent))),
            }),
            enabled: false,
          },
          ...(window.resetsAt
            ? [{ label: nativeT("desktop.tray.resets", { time: nativeDateTime(window.resetsAt) }), enabled: false }]
            : []),
        ]),
        ...(report.metrics ?? []).map((metric): MenuItemConstructorOptions => ({
          label: nativeT("desktop.tray.metric", {
            resource: metric.id,
            value: nativeNumber(metric.value),
            unit: metric.unit,
          }),
          enabled: false,
        })),
        ...(report.windows.length === 0 && !report.metrics?.length
          ? [{
              label: nativeT(
                report.staleLimits
                  ? report.source === "cache"
                    ? "desktop.tray.staleLimits"
                    : "desktop.tray.staleOtherLimits"
                  : report.expiredLimits
                    ? "desktop.tray.expiredLimits"
                    : "desktop.tray.noLimits",
              ),
              enabled: false,
            }]
          : []),
        ...(report.totals.sessions > 0 ? [
          { type: "separator" as const },
          {
            label: nativeT("desktop.tray.tokens", {
              input: nativeNumber(report.totals.input),
              output: nativeNumber(report.totals.output),
            }),
            enabled: false,
          },
        ] : []),
        ...(report.outdated ? [{ label: nativeT("desktop.tray.outdated"), enabled: false }] : []),
        ...(report.error ? [{ label: nativeT("desktop.tray.refreshFailed"), enabled: false }] : []),
      ],
    }))
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: nativeT("desktop.menu.app"), enabled: false },
        { type: "separator" },
        { label: nativeT("desktop.tray.running"), enabled: false },
        ...(sessionItems.length ? sessionItems : [{ label: nativeT("desktop.tray.noneRunning"), enabled: false }]),
        ...(model.moreRunning
          ? [{ label: nativeT("desktop.tray.moreRunning", { count: model.moreRunning }), enabled: false }]
          : []),
        { type: "separator" },
        { label: nativeT("desktop.tray.usage"), enabled: false },
        ...(usageItems.length ? usageItems : [{ label: nativeT("desktop.tray.noLimits"), enabled: false }]),
        { type: "separator" },
        { label: nativeT("desktop.tray.refresh"), click: () => void refresh(true) },
        { label: nativeT("desktop.tray.openUsage"), click: () => open("tray.usage") },
        { label: nativeT("desktop.tray.openApp"), click: () => open() },
      ]),
    )
  }
  const refresh = async (force = false) => {
    if (!usageMonitoringEnabled()) {
      reports = []
      render()
      return
    }
    try {
      const next = await readInstalledAgentUsage(force)
      if (!usageMonitoringEnabled()) return
      reports = next
      render()
    } catch (error) {
      writeLog("utility", "menu bar usage refresh failed", { error: String(error) }, "warn")
    }
  }
  const unsubscribe = subscribeAgentSessionStatus(render)
  const unsubscribeUsage = subscribeUsageMonitoring(() => void refresh(true))
  render()
  void refresh()
  const timer = setInterval(() => void refresh(true), 5 * 60_000)
  timer.unref()
  const tick = setInterval(render, 60_000)
  tick.unref()
  app.once("will-quit", () => {
    clearInterval(timer)
    clearInterval(tick)
    unsubscribe()
    unsubscribeUsage()
    tray.destroy()
  })
  return render
}
