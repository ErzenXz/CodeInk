# CodeInk

![CodeInk artwork](docs/codeink-banner.png)

**One desktop workspace for the coding agents you already use.** CodeInk connects Codex, Claude Code, OpenCode, Pi, and compatible Agent Client Protocol (ACP) agents in a single app. Install and sign in to each agent separately; CodeInk does not ship an agent runtime or ask for its credentials.

[Website](https://www.getcode.ink/) · [Download](https://www.getcode.ink/download.html) · [Features](https://www.getcode.ink/features.html) · [Agents](https://www.getcode.ink/agents.html) · [Releases](https://github.com/ErzenXz/CodeInk/releases)

CodeInk is an independent, open source fork of [OpenCode](https://github.com/anomalyco/opencode). The upstream MIT notice and provenance remain in the repository; CodeInk's current combined distribution is under [GPL-3.0-or-later](LICENSE). See [Licensing and attribution](#licensing-and-attribution).

## Why CodeInk?

- **Keep your agents.** Use their own installations, accounts, model catalogs, and permissions. CodeInk provides a common desktop interface.
- **Work by project.** Organize projects, sessions, files, terminals, and reviews in one place.
- **See what happened.** Follow streaming responses, tool activity, edits, approval requests, and session history.
- **Stay local.** CodeInk stores its desktop state locally. Your selected agent controls its own model-provider connection; review that agent's privacy terms before using it with sensitive code.
- **Choose a release channel.** Production and Early Access install as separate apps with separate data folders.

The four native integrations are Codex, Claude Code, OpenCode, and Pi. CodeInk also includes 22 ACP launch presets and supports custom ACP agents. A preset is a launch definition, not a promise that every agent version has been tested. See [agent integrations and setup](AGENT-SOURCES.md) for protocol details and limitations.

## Download and install

| Platform | Available packages |
| --- | --- |
| macOS | Apple Silicon and Intel `.dmg` |
| Windows | x64 `.exe` installer |
| Linux | x64 and ARM64 `.AppImage` and `.deb` |

Get the latest build from [getcode.ink/download.html](https://www.getcode.ink/download.html). The page shows Production and Early Access releases, checksums, and release notes from the [CodeInk GitHub releases](https://github.com/ErzenXz/CodeInk/releases). Early Access can be installed beside Production.

macOS releases require a Developer ID signature and Apple notarization. The `v0.1.16` production and `v0.1.15-early-access` macOS builds were published without them and can show a misleading “damaged” warning. Wait for a newer signed release before installing on macOS. Windows may show SmartScreen. Compare the downloaded file with the release's `SHA256SUMS.txt` if you want to verify its integrity; checksums do not establish publisher identity.

**Existing installations with the old disabled updater need one manual download.** New builds can check CodeInk's releases from the app and open the matching channel on the CodeInk download page. Installation remains a manual step.

## Get started

1. Install and authenticate at least one supported agent using its own instructions. For example, use `codex login` or `claude auth login` if those CLIs are your choice.
2. Install CodeInk from the [download page](https://www.getcode.ink/download.html) and open it.
3. Add or select a project folder. CodeInk discovers supported installed agents, and you can configure a custom executable and arguments when needed.
4. Pick an agent and a model, then start a session. The agent handles prompts, tools, permissions, and provider access through its own runtime.

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
bun test src/test
bun run build
bun run package
```

Run tests and `bun typecheck` from the relevant package directory, never from the repository root. The root `bun dev` command starts the desktop development build. For frontend changes, check `packages/app/AGENTS.md`; for desktop changes, check `packages/desktop/AGENTS.md`. Packaging and release details are in [RELEASING.md](RELEASING.md).

## Repository map

| Path | Purpose |
| --- | --- |
| `packages/desktop` | Electron main process, native integrations, local session bridge, and installers |
| `packages/app` | Solid application and desktop interface |
| `packages/ui`, `packages/session-ui` | Shared components, themes, and session presentation |
| `packages/schema`, `packages/core`, `packages/sdk/js` | Retained browser utilities, schemas, and SDK contracts |
| `website` | Static CodeInk website at [getcode.ink](https://www.getcode.ink/) |

The desktop connects to independently installed agents through their protocols. It does not bundle Codex, Claude Code, OpenCode, Pi, or an ACP agent executable. [UPSTREAM.md](UPSTREAM.md) records the exact OpenCode revision and explains which upstream components remain in this fork.

## Contributing and support

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, use the [issue templates](.github/ISSUE_TEMPLATE) for bugs and ideas, and follow the [Code of Conduct](CODE_OF_CONDUCT.md). For ordinary help, see [SUPPORT.md](SUPPORT.md); for a security issue, follow [SECURITY.md](SECURITY.md) instead of posting exploit details publicly.

Development happens on `development`; tested changes are merged into `main`. Both branches publish their own desktop channel. Pull requests should target `development` unless a maintainer asks for another base. The release pipeline builds native packages on macOS, Windows, and Linux before publishing a release.

## Licensing and attribution

CodeInk's current combined distribution and new CodeInk contributions are offered under the **GNU General Public License, version 3 or later** ([GPL-3.0-or-later](LICENSE)). The OpenCode code incorporated into this fork keeps its original MIT copyright and permission notice in [licenses/UPSTREAM-MIT.txt](licenses/UPSTREAM-MIT.txt); other third-party components retain their own licenses. See [LICENSE-NOTICE.md](LICENSE-NOTICE.md) and [UPSTREAM.md](UPSTREAM.md) for the scope and provenance.

Earlier CodeInk releases were distributed under MIT. Changing the license for new releases does not retract permissions granted for those earlier versions. Agent and product names and marks belong to their respective owners; their appearance here does not imply endorsement.
