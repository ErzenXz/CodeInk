import type { UpdaterState } from "@codeink/app/updater"
import { isNewerRelease } from "./release-update"

export type { UpdaterState } from "@codeink/app/updater"

export function createUpdaterController(input: {
  enabled: boolean
  currentVersion: string
  checkForUpdates: () => Promise<string>
  downloadUpdate?: () => Promise<unknown>
  installUpdate?: () => Promise<void> | void
  openDownload?: () => void
  log?: (message: string, data?: object) => void
}) {
  let state: UpdaterState = input.enabled ? { status: "idle" } : { status: "disabled" }
  let pending: Promise<UpdaterState> | undefined
  const listeners = new Set<(state: UpdaterState) => void>()

  const transition = (next: UpdaterState) => {
    input.log?.("updater state changed", { from: state.status, to: next.status })
    state = next
    listeners.forEach((listener) => listener(state))
    return state
  }

  const check = () => {
    if (!input.enabled) return Promise.resolve(state)
    if (state.status === "downloading" || state.status === "ready" || state.status === "installing")
      return Promise.resolve(state)
    if (pending) return pending

    pending = (async () => {
      transition({ status: "checking" })
      const version = await input.checkForUpdates()
      if (!isNewerRelease(version, input.currentVersion)) return transition({ status: "up-to-date" })
      if (!input.downloadUpdate) return transition({ status: "available", version })
      transition({ status: "downloading", version })
      void input.downloadUpdate()
        .then(() => {
          if (state.status === "downloading" && state.version === version) transition({ status: "ready", version })
        })
        .catch((error) =>
          transition({ status: "error", message: error instanceof Error ? error.message : String(error) }),
        )
      return state
    })()
      .catch((error) =>
        transition({ status: "error", message: error instanceof Error ? error.message : String(error) }),
      )
      .finally(() => {
        pending = undefined
      })
    return pending
  }

  return {
    getState: () => state,
    subscribe(listener: (state: UpdaterState) => void) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },
    start: check,
    check,
    openDownload() {
      if (state.status !== "available") return
      input.openDownload?.()
    },
    install() {
      if (state.status !== "ready" || !input.installUpdate) return
      transition({ status: "installing", version: state.version })
      void Promise.resolve()
        .then(input.installUpdate)
        .catch((error) =>
          transition({ status: "error", message: error instanceof Error ? error.message : String(error) }),
        )
    },
  }
}

export type UpdaterController = ReturnType<typeof createUpdaterController>
