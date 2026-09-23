# Desktop UI inventory

CodeInk Desktop runs the Solid app in an Electron shell. The desktop shell is in `packages/desktop/src`; routing, sessions, sidebar, settings, and the composer are in `packages/app/src`.

| UI layer                  | Location                                                     | Current use                                                          |
| ------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| Shared controls and icons | `packages/ui/src/components`                                 | Original controls still used by active app screens                   |
| Newer controls and icons  | `packages/ui/src/v2/components`                              | Sidebar, settings, menus, dialogs, and current session controls      |
| Transcript and review     | `packages/session-ui/src/components` and `src/v2/components` | Messages, markdown, tool activity, diffs, review, and composer parts |
| App screens               | `packages/app/src/pages` and `src/components`                | Home, session, settings, sidebar, titlebar, and agent controls       |
| Agent adapters            | `packages/desktop/src/main/adapters`                         | CodeInk's connections to installed coding agents                     |

The `v1` and `v2` names describe generations of UI and server contracts. Both UI generations are still reachable through the interface setting in `packages/app/src/context/settings.tsx` and routes in `packages/app/src/app.tsx`. Removing the older components today would remove a selectable interface and break legacy session and server handling. They are CodeInk-owned workspace code under `@codeink/*` names.

The default and classic presets are `codeink` and `codeink-classic`. Theme preload, CSS/DOM identifiers, the Electron renderer scheme, the internal channel variables, and the app deep-link event now use CodeInk names. Saved `oc-1`, `oc-2`, `opencode` theme IDs and old theme storage keys migrate to the new names. The app registers and accepts `codeink://` links while still parsing existing `opencode://` project links for compatibility.

OpenCode remains a selectable **agent**. The `@opencode-ai/client` archive and OpenCode-specific server/WSL code are protocol compatibility integrations, not CodeInk branding or bundled CLI code. Existing `opencode.*` store files and legacy app IDs are still read for user-data migration. Upstream notices remain in the repository and release resources.
