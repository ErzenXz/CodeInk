import type { UpdaterState } from "@codeink/app/updater"
import { isNewerRelease } from "./release-update"

export type { UpdaterState } from "@codeink/app/updater"

export function createUpdaterController(input: {
  enabled: boolean
  currentVersion: string
  checkForUpdates: () => Promise<string>
  openDownload: () => void
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
    if (pending) return pending

    pending = (async () => {
      transition({ status: "checking" })
      const version = await input.checkForUpdates()
      return transition(isNewerRelease(version, input.currentVersion) ? { status: "available", version } : { status: "up-to-date" })
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
      input.openDownload()
    },
  }
}

export type UpdaterController = ReturnType<typeof createUpdaterController>
