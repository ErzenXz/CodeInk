# CodeInk

By **[Erzen Krasniqi](https://github.com/ErzenXz)**. [Download CodeInk](https://erzenxz.github.io/CodeInk/) · [Releases](https://github.com/ErzenXz/CodeInk/releases)

The **original OpenCode desktop application**, adapted to use coding agents installed separately on your computer. This repository is a desktop-only fork of [anomalyco/opencode](https://github.com/anomalyco/opencode), not a replacement interface.

The upstream home screen, tabs, session pages, composer, message timeline, review panels, terminal, themes, and shared UI components retain their layout. The app uses CodeInk branding and a new generated icon; see [BRAND.md](BRAND.md). The provider sign-in dialog now configures local agent executables. No OpenCode CLI, Codex CLI, Claude Code CLI, or Pi runtime is bundled or downloaded by this app.

## Run

Install [Bun](https://bun.sh), then run from this repository:

```sh
bun install
bun dev
```

Install and authenticate at least one agent independently. CodeInk discovers executables through your login shell's `PATH`. Open a project, choose an installed agent and model in the original composer picker, and send a prompt. Use **Settings → Agents → Configure agents** to set an executable path or add a compatible custom command.

| Agent       | Executable                          | Connection                                     |
| ----------- | ----------------------------------- | ---------------------------------------------- |
| Codex       | `codex`                             | `app-server`, JSON-RPC over stdin/stdout       |
| Claude Code | `claude`                            | Bidirectional stream JSON and control requests |
| OpenCode    | `opencode`                          | Independently installed local HTTP/SSE server  |
| Pi          | `pi`                                | RPC over stdin/stdout                          |
| ACP agents  | Separately installed CLI or adapter | ACP v1 over stdin/stdout                       |
| Custom      | User-supplied path                  | One of the five protocols above                |

CodeInk includes 22 additional ACP presets for Gemini CLI, Copilot, Cursor, Cline, Kimi, Qwen, Goose, Vibe, Auggie, Droid, Kilo, Devin, Amp, Qoder, CodeBuddy, Cortex, Junie, DeepAgents, MiniMax Code, Grok Build, Stakpak, and Nova. See [AGENT-SOURCES.md](AGENT-SOURCES.md) for launch commands, capability limits, and icon sources.

Credentials and model configuration remain with each installed agent. The original model picker and Manage models dialog load native catalogs from Codex's `model/list`, Claude Code's initialization response, OpenCode's connected providers, and Pi's `get_available_models`. Discovery sends no prompts. Each agent loads independently; its results are cached per project, and saving its configuration refreshes the cache. When discovery fails, an explicitly labeled agent-default option remains available. Models retain the agent’s order with its default first. Claude aliases resolve to versioned model names; OpenCode uses compact GO, ZEN, and FREE badges. ACP catalog discovery initializes an empty native session and deletes it when supported.

Select a model and, where advertised by the agent, a reasoning level in the original composer. You can change these between turns in the same conversation; CodeInk resumes the native session and preserves each earlier turn's model label. Start a new session to change the agent or project.

## Build

```sh
bun run build
bun run package
```

Packages are written to `packages/desktop/dist`. Platform-specific packaging scripts are available inside `packages/desktop`. Pushes to `main` build and publish Production releases; pushes to `development` build and publish Early Access prereleases. The download website tracks both channels automatically. See [RELEASING.md](RELEASING.md) for supported platforms, signing configuration, and versioning. Automatic in-app updates remain disabled; install updates from the website.

## Validate

Run checks from the desktop package:

```sh
cd packages/desktop
bun typecheck
bun test src/test
bun run test:terminal
bun run test:installed
```

The protocol tests use real subprocess fixtures for all five protocols, including model discovery, model/effort forwarding, structured tool calls, streamed text, approvals, cancellation, process failure, and session resume after a model change. ACP has additional tests for both catalog formats, permission mapping, and resume capability negotiation. The HTTP integration test uses the upstream SDK's approval endpoint. The terminal smoke test runs a real shell under Node (the runtime used by Electron); it requires Node on `PATH`. The installed-agent smoke test discovers models from each installed agent and sends no model prompts.

After building, `bun run test:native` opens the original desktop UI with isolated temporary state and local protocol fixtures. Its agents never call a model service. Close that test application to remove its temporary state.

## Scope

The connection layer supports text prompts, local file mentions, streaming responses, structured tool activity, approvals/questions, stop, native session resume, local file browsing, Git inspection, and the original terminal. Tool names, inputs, outputs, and execution status are translated into the original timeline’s tool cards. Older saved tool events are decoded when their original details are available. It runs inside Electron; OpenCode's coding-agent backend is removed.

This is not yet full backend feature parity. Upstream actions requiring OpenCode-specific agent internals—fork/revert/compaction, cloud sharing, worktree orchestration, MCP/skill management, and rich attachments—are not translated across all engines. Unsupported requests return an explicit error. Model limits, live context usage, and costs appear when the agent reports them. Unknown values remain unavailable rather than being estimated as zero. Context tokens describe the latest model call, not the sum of every call; cache and reasoning tokens are not double-counted. ACP agents can report context usage without a detailed token breakdown. WSL integration is not validated and the inherited WSL agent installer is disabled.

If Claude Code reports an expired OAuth login, run `claude auth login` in your terminal and retry the message. CodeInk displays a single recovery message and leaves authentication with the CLI.

CodeInk stores its own session data in the OS application-data directory under `CodeInk` (Production), `CodeInk Early Access`, or `CodeInk Dev` and does not migrate your OpenCode installation. Set `CODEINK_DATA_DIR` for an isolated development profile.

See [UPSTREAM.md](UPSTREAM.md) for the exact source revision and retained packages. Original copyright and [MIT license](LICENSE) are preserved.
