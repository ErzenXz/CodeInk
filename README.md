# CodeInk

![CodeInk artwork](docs/codeink-banner.png)

**One desktop workspace for your coding agents.** CodeInk connects Codex, Claude Code, OpenCode, Pi, and compatible Agent Client Protocol (ACP) agents in one app. It also includes CodeInk Agent, which runs with a Vercel AI Gateway or OpenRouter API key you provide.

[Website](https://www.getcode.ink/) · [Download](https://www.getcode.ink/download.html) · [Features](https://www.getcode.ink/features.html) · [Agents](https://www.getcode.ink/agents.html) · [Releases](https://github.com/ErzenXz/CodeInk/releases)

## Why CodeInk?

- **Keep your agents.** Use their own installations, accounts, model catalogs, and permissions. CodeInk provides a common desktop interface.
- **Use CodeInk Agent.** Add a gateway key, select a model, and let the built-in agent work through one terminal tool. It asks before running commands by default.
- **Work by project.** Organize projects, sessions, files, terminals, and reviews in one place.
- **Work side by side.** Open up to three live sessions in panes and collapse the session sidebar when you need more room.
- **See what happened.** Follow streaming responses, tool activity, edits, approval requests, and session history.
- **Keep local state.** CodeInk stores sessions and gateway keys on your computer. External agents manage their own sign-in; CodeInk Agent sends prompts and terminal results to the gateway you choose.
- **Choose a release channel.** Production and Early Access install as separate apps with separate data folders.

CodeInk Agent is built in. The four external native integrations are Codex, Claude Code, OpenCode, and Pi. CodeInk also includes 22 ACP launch presets and supports custom ACP agents. A preset is a launch definition, not a promise that every agent version has been tested. See [agent integrations and setup](AGENT-SOURCES.md) for protocol details and limitations.

## Download and install

| Platform | Available packages                   |
| -------- | ------------------------------------ |
| macOS    | Apple Silicon and Intel `.dmg`       |
| Windows  | x64 `.exe` installer                 |
| Linux    | x64 and ARM64 `.AppImage` and `.deb` |

Get the latest build from [getcode.ink/download.html](https://www.getcode.ink/download.html). The page shows Production and Early Access releases, checksums, and release notes from the [CodeInk GitHub releases](https://github.com/ErzenXz/CodeInk/releases). Early Access can be installed beside Production.

macOS releases are signed and notarized. Windows may show SmartScreen. Compare the downloaded file with the release's `SHA256SUMS.txt` if you want to verify its integrity; checksums do not establish publisher identity.

**Existing installations with the old disabled updater need one manual download.** Current builds can download and install supported updates in the app. The download page remains available for manual installation.

## Get started

1. Install and authenticate an external agent, or get a Vercel AI Gateway or OpenRouter API key for CodeInk Agent.
2. Install CodeInk from the [download page](https://www.getcode.ink/download.html) and open it.
3. Add or select a project folder. For CodeInk Agent, add your key under Settings → CodeInk Agent. For external agents, CodeInk discovers installed CLIs and lets you configure a custom executable when needed.
4. Pick an agent and model, then start a session. CodeInk Agent asks before terminal commands unless you choose Full access. External agents use their own tools and permissions.

If an agent is missing, check that its CLI is installed and available on the app's `PATH`. See [AGENT-SOURCES.md](AGENT-SOURCES.md) for supported commands, ACP capabilities, and known limits. For installation questions, see the [FAQ](https://www.getcode.ink/faq.html) and [support guide](SUPPORT.md).

## Build from source

The repository uses [Bun](https://bun.sh/) 1.3.14 and a workspace of TypeScript packages. Node.js 24 is used in release builds. Install dependencies from the repository root:

```sh
bun install --frozen-lockfile
bun dev
```

Useful commands:

```sh
cd packages/desktop
bun typecheck
bun run test
bun run build
bun run package
```

Run tests and `bun typecheck` from the relevant package directory, never from the repository root. The desktop test command includes adapter, bridge, usage, updater, and storage tests. It needs Node.js 24 to exercise the native SQLite draft store. The root `bun dev` command starts the desktop development build. For frontend changes, check `packages/app/AGENTS.md`; for desktop changes, check `packages/desktop/AGENTS.md`. Packaging and release details are in [RELEASING.md](RELEASING.md).

## Repository map

| Path                                                  | Purpose                                                                          |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/desktop`                                    | Electron main process, native integrations, local session bridge, and installers |
| `packages/app`                                        | Solid application and desktop interface                                          |
| `packages/ui`, `packages/session-ui`                  | Shared components, themes, and session presentation                              |
| `packages/schema`, `packages/core`, `packages/sdk/js` | Retained browser utilities, schemas, and SDK contracts                           |
| `website`                                             | Static CodeInk website at [getcode.ink](https://www.getcode.ink/)                |

The desktop includes CodeInk Agent and connects to independently installed external agents through their protocols. It does not bundle external agent executables. [UPSTREAM.md](UPSTREAM.md) records the source history of retained components.

## Contributing and support

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, use the [issue templates](.github/ISSUE_TEMPLATE) for bugs and ideas, and follow the [Code of Conduct](CODE_OF_CONDUCT.md). For ordinary help, see [SUPPORT.md](SUPPORT.md); for a security issue, follow [SECURITY.md](SECURITY.md) instead of posting exploit details publicly.

Development happens on `development`; tested changes are merged into `main`. Both branches publish their own desktop channel. Pull requests should target `development` unless a maintainer asks for another base. The release pipeline builds native packages on macOS, Windows, and Linux before publishing a release.

## Licensing and attribution

CodeInk is offered under the **GNU General Public License, version 3 or later** ([GPL-3.0-or-later](LICENSE)). See [LICENSE-NOTICE.md](LICENSE-NOTICE.md) for required third-party notices and [UPSTREAM.md](UPSTREAM.md) for source history.

Earlier CodeInk releases were distributed under MIT. Changing the license for new releases does not retract permissions granted for those earlier versions. Agent and product names and marks belong to their respective owners; their appearance here does not imply endorsement.
