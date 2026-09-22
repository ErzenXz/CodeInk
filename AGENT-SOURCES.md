# Agent integrations and icon sources

CodeInk keeps the original OpenCode interface and connects to independently installed agents. It never invokes `npx`, `uvx`, a package installer, or a downloaded agent runtime automatically.

The four native adapters are Codex app-server, Claude Code stream JSON, OpenCode HTTP/SSE, and Pi RPC. An additional ACP adapter supports protocol v1, text streaming, tool updates, one-time permission decisions, cancellation, session model/reasoning options, and native resume when advertised. It supports both current `configOptions` catalogs and older `models.availableModels` catalogs. Agents retain ownership of filesystem and terminal tools; client-hosted filesystem and terminal capabilities are not advertised. ACP versions that require those client capabilities are not compatible with this adapter yet.

Model discovery never sends a prompt. ACP catalogs require `session/new`; the probe session is deleted if the agent advertises `session/delete`. Otherwise that agent may retain an empty native session. Unsupported resume returns an explicit error instead of silently creating a new conversation.

## Presets

The launch arguments below were checked against the [official ACP registry](https://github.com/agentclientprotocol/registry) and its [published catalog](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json) on 2026-09-22. npm executable names were verified against each package's published `bin` metadata. Install and authenticate each agent separately. Some agents require a separate ACP adapter executable; configuring the ordinary interactive CLI in its place will not work.

| Agent          | Executable and arguments                |
| -------------- | --------------------------------------- |
| Gemini CLI     | `gemini --acp`                          |
| GitHub Copilot | `copilot --acp`                         |
| Cursor         | `cursor-agent acp`                      |
| Cline          | `cline --acp`                           |
| Kimi CLI       | `kimi acp`                              |
| Qwen Code      | `qwen --acp`                            |
| Goose          | `goose acp`                             |
| Mistral Vibe   | `vibe-acp`                              |
| Auggie         | `auggie --acp`                          |
| Factory Droid  | `droid exec --output-format acp-daemon` |
| Kilo           | `kilo acp`                              |
| Devin          | `devin acp`                             |
| Amp            | `amp-acp`                               |
| Qoder          | `qoder --acp`                           |
| CodeBuddy      | `codebuddy --acp`                       |
| Cortex Code    | `cortex acp serve`                      |
| Junie          | `junie --acp=true`                      |
| DeepAgents     | `deepagents-acp`                        |
| MiniMax Code   | `mcode acp`                             |
| Grok Build     | `grok agent stdio`                      |
| Stakpak        | `stakpak acp`                           |
| Nova           | `nova acp`                              |

Custom agents can use any of the five supported protocols. Existing configurations keep their executable paths and arguments when new presets are added.

## Icons

- OpenAI and Anthropic: retained upstream provider SVGs from [anomalyco/opencode](https://github.com/anomalyco/opencode/tree/dev/packages/ui/src/assets/icons/provider).
- Pi: the [official pi.dev favicon](https://pi.dev/favicon.svg).
- OpenCode and the 22 ACP presets: each agent's `icon.svg` in the [official ACP registry](https://github.com/agentclientprotocol/registry). Original files are retained under `packages/ui/src/assets/icons/agent`; the compiled sprite uses `currentColor` for monochrome artwork so the icons work with the app's light and dark themes.

Names and logos identify the external agents and do not imply affiliation or endorsement. Upstream licenses and attribution remain in this repository.

## Claude authentication

Claude Code's `initialize` catalog exposes `resolvedModel`, which CodeInk uses to label and select versioned models and deduplicate aliases. An expired OAuth login is reported as one actionable error directing the user to `claude auth login`. Credentials remain managed by the CLI; CodeInk does not copy tokens or add its own provider login flow. See [Claude Code authentication](https://code.claude.com/docs/en/authentication).

## Validation

All five protocols are covered by local subprocess integration tests. Real installed catalogs were also checked for Codex, Claude Code, OpenCode, and Devin. Other ACP presets have verified launch definitions and protocol fixture coverage, but were not individually installed or authenticated during this change.
