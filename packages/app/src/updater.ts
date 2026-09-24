import type { Accessor } from "solid-js"

export type UpdaterState =
  | { status: "disabled" }
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string }
  | { status: "downloading"; version: string }
  | { status: "ready"; version: string }
  | { status: "installing"; version: string }
  | { status: "up-to-date" }
  | { status: "error"; message: string }

export type UpdaterPlatform = {
  state: Accessor<UpdaterState>
  check(): Promise<UpdaterState>
  openDownload(): Promise<void>
  install(): Promise<void>
}
