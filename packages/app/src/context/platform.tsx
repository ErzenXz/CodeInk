import { createSimpleContext } from "@codeink/ui/context"
import type { AsyncStorage, SyncStorage } from "@solid-primitives/storage"
import type { Accessor } from "solid-js"
import type { DesktopMenuAction } from "../desktop-menu"
import { ServerConnection } from "./server"
import type { WslServersPlatform } from "../wsl/types"
import type { UpdaterPlatform } from "../updater"
import type { DraftStore } from "@/utils/draft-store"

type PickerPaths = string | string[] | null
type OpenDirectoryPickerOptions = { title?: string; multiple?: boolean }
type OpenAttachmentPickerOptions = {
  title?: string
  multiple?: boolean
  accept?: string[]
  extensions?: string[]
  defaultPath?: string
}
type SaveFilePickerOptions = { title?: string; defaultPath?: string }
type PlatformName = "web" | "desktop"
type DesktopOS = "macos" | "windows" | "linux"

export type FatalRendererErrorLog = {
  error: string
  url: string
  version?: string
  platform: PlatformName
  os?: DesktopOS
}

export type LocalAgentConnection = {
  id: string
  name: string
  protocol: "codex" | "claude" | "opencode" | "pi" | "acp"
  command: string
  args: string[]
  executable?: string
}

export type AgentExtension = {
  id: string
  agentID: string
  kind: "skill" | "plugin" | "mcp"
  name: string
  description?: string
  source?: string
  version?: string
  path?: string
  enabled?: boolean
  toggleable: boolean
  status?: string
  tools?: number
}

export type AgentExtensionReport = { agentID: string; name: string; extensions: AgentExtension[]; error?: string }

export type AgentLimitWindow = {
  id: string
  kind: "session" | "weekly" | "other"
  usedPercent: number
  resetsAt?: number
  label?: string
  warning?: boolean
}

export type AgentUsageReport = {
  agentID: string
  name: string
  installed: boolean
  plan?: string
  windows: AgentLimitWindow[]
  source?: "live" | "cache"
  fetchedAt?: number
  error?: string
  totals: {
    sessions: number
    messages: number
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    cost?: number
    lastUsed?: number
  }
}

export type AgentAccess = "ask" | "edits" | "auto" | "plan" | "full"
export type AgentRulesReport = {
  agentID: string
  name: string
  access: AgentAccess
  fast: boolean
  accessOptions: AgentAccess[]
  fastModels: string[]
  autoModels: string[]
}

export type AgentInstructions = {
  agentID: string
  name: string
  installed: boolean
  path: string
  content: string
  exists: boolean
}

type PlatformBase = {
  localAgents?: {
    list(): Promise<LocalAgentConnection[]>
    save(agent: LocalAgentConnection): Promise<LocalAgentConnection[]>
  }
  /** Skills, plugins, MCP servers, plan usage, and global instructions of locally installed agents. */
  agentWorkspace?: {
    extensions(refresh?: boolean): Promise<AgentExtensionReport[]>
    setExtensionEnabled(input: {
      agentID: string
      kind: AgentExtension["kind"]
      id: string
      path?: string
      enabled: boolean
    }): Promise<void>
    usage(refresh?: boolean): Promise<AgentUsageReport[]>
    /** Per-agent access level and fast mode, applied to the agent's next turn. */
    rules(): Promise<AgentRulesReport[]>
    setRules(agentID: string, rules: { access: AgentAccess; fast: boolean }): Promise<AgentRulesReport[]>
    instructions(): Promise<AgentInstructions[]>
    saveInstructions(agentID: string, content: string): Promise<void>
  }
  /** App version */
  version?: string

  /** Open a web or mail URL in the default system application */
  openExternal(url: string): void

  /** Open a local path in a local app (desktop only) */
  openPath?(path: string, app?: string): Promise<void>

  /** Open a local file URL in its default app (desktop only) */
  openLocalFile?(url: string): void

  /** Reveal a local path in the system file manager; false when the path does not exist (desktop only) */
  revealPath?(path: string): Promise<boolean>

  /** Restart the app  */
  restart(): Promise<void>

  /** Send a system notification */
  notify(title: string, description?: string, onClick?: () => void): Promise<void>

  /** Open a native attachment picker and read selected files sequentially (desktop only) */
  openAttachmentPickerDialog?(
    opts: OpenAttachmentPickerOptions,
    onFile: (file: File) => Promise<unknown>,
  ): Promise<void>

  /** Resolve the native source path for a desktop File. */
  getPathForFile?(file: File): string

  /** Open a native save file picker dialog (desktop only) */
  saveFilePickerDialog?(opts?: SaveFilePickerOptions): Promise<string | null>

  /** Storage mechanism, defaults to localStorage */
  storage?: (name?: string) => SyncStorage | AsyncStorage

  /** Prompt drafts, history, and their blobs. */
  draftStore?: DraftStore

  /** Stable platform window identity for window-scoped persistence */
  windowID?: string

  /** Application-global desktop updater */
  updater?: UpdaterPlatform

  /** Fetch override */
  fetch?: typeof fetch

  /** Get the configured default server URL (platform-specific) */
  getDefaultServer?(): Promise<ServerConnection.Key | null>

  /** Set the default server URL to use on app startup (platform-specific) */
  setDefaultServer?(url: ServerConnection.Key | null): Promise<void> | void

  /** Manage WSL sidecar servers (Electron on Windows only) */
  wslServers?: WslServersPlatform

  /** Get the preferred display backend (desktop only) */
  getDisplayBackend?(): Promise<DisplayBackend | null> | DisplayBackend | null

  /** Set the preferred display backend (desktop only) */
  setDisplayBackend?(backend: DisplayBackend): Promise<void>

  /** Webview zoom level (desktop only) */
  webviewZoom?: Accessor<number>

  /** Whether the native desktop window is fullscreen */
  windowFullscreen?: Accessor<boolean>

  /** Get whether native pinch/Ctrl-scroll zoom gestures are enabled (desktop only) */
  getPinchZoomEnabled?(): Promise<boolean> | boolean

  /** Allow native pinch/Ctrl-scroll zoom gestures (desktop only) */
  setPinchZoomEnabled?(enabled: boolean): Promise<void> | void

  /** Run a desktop-only menu action from the app chrome */
  runDesktopMenuAction?(action: DesktopMenuAction): Promise<void> | void

  /** Check if an editor app exists (desktop only) */
  checkAppExists?(appName: string): Promise<boolean>

  /** Read image from clipboard (desktop only) */
  readClipboardImage?(): Promise<File | null>

  /** Export collected diagnostic logs (desktop only) */
  exportDebugLogs?(): Promise<string>

  /** Force focus styles on interactive elements through desktop devtools (desktop only) */
  setForceFocus?(enabled: boolean): Promise<void>

  /** Record a fatal renderer error in platform logs (desktop only) */
  recordFatalRendererError?(error: FatalRendererErrorLog): Promise<void>
}

export type Platform = PlatformBase &
  (
    | { platform: "web"; os?: never }
    | {
        platform: "desktop"
        os?: DesktopOS
        openDirectoryPickerDialog(opts?: OpenDirectoryPickerOptions): Promise<PickerPaths>
      }
  )

export type DisplayBackend = "auto" | "wayland"

export const { use: usePlatform, provider: PlatformProvider } = createSimpleContext({
  name: "Platform",
  init: (props: { value: Platform }) => {
    return props.value
  },
})
