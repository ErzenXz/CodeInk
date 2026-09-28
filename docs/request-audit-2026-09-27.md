# CodeInk request audit

This checks the requests in the launch and app-development conversation against the local source, executable checks, and previously verified release evidence. Updated September 27, 2026. The local branch is `codex-settings`, based on release commit `a63653e`. All new work remains local. No claim here means that every third-party agent, operating system, or provider model has been tested live.

## Published launch and repository work

| Request | Status and evidence |
| --- | --- |
| Use getcode.ink | Confirmed live: both `https://getcode.ink/` and `https://www.getcode.ink/download.html` respond. Repository homepage and website canonical links use this domain. |
| Expand README, contributing and open-source docs | Present: README, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, SUPPORT, RELEASING, issue and PR templates. This audit corrects outdated update/install instructions and expands the documented desktop test command. |
| GPLv3 licensing | Present: GPL-3.0-or-later package metadata and LICENSE. Required upstream notices remain in dedicated attribution files. |
| Use GitHub private reporting | Confirmed enabled by GitHub API. SECURITY.md links to private vulnerability reporting. CODE_OF_CONDUCT.md uses GitHub's Report content action for conduct reports. |
| Push development, then main | Previously authorized release work was published from `a63653e`. New changes have not been committed or pushed, following the later instruction. |
| Fix macOS “damaged” download and configure signing | Production v0.1.38 is published with 15 assets. Prior release verification passed Apple notarization for both architectures, public ARM64 DMG checksum/signature/Gatekeeper/stapler, and app signature/Gatekeeper. This audit does not rerun the installed app. |
| Simple release notes and website download links | Present in v0.1.38 and the CodeInk download page. GitHub still marks v0.1.38 Latest on this audit date. |
| In-app updates instead of opening the browser | Implemented for macOS, Windows and Linux AppImage. Controller and real metadata-parser tests pass. `.deb` uses a manual download. Old clients with the disabled updater need one manual upgrade. An actual installed-app replacement was not repeated in this audit. |
| Stop scheduled monitoring when complete | Completed in the previous release-verification turn. The heartbeat was deleted after both channel releases were checked. |
| Product Hunt launch tomorrow, launch time and live link | Live listing reverified in the browser. Previous dashboard evidence records launch on September 24 at 00:01 Pacific, 09:01 Europe/Belgrade. Listing: https://www.producthunt.com/products/codeink?launch=codeink. |
| Product Hunt website badge | Present in the local source and live website. |
| Product Hunt co-makers | “Only me” was the final answer. No co-maker invitation is required. |
| Product Hunt shoutouts and first comment | Reverified in the browser: Bun, GitHub and Vite shoutouts are displayed, and the maker comment uses the supplied reason for building CodeInk. |
| Product Hunt comment awards and reply to Dren | Not verified. The live listing currently exposes the maker comment but not the cited Dren comment or a reply receipt. |
| X logo crop, cover, launch post | Reverified in the browser: the entire logo fits inside its avatar, a cover image is present, and September 23 and September 24 launch posts are public. |
| Share in at least 10 places and more Reddit posts | Eleven public placements reverified: nine Reddit communities, X and Product Hunt. One additional r/indiehackers post was removed by moderators and is excluded. Links are below. |
| Run Claude Opus for website improvements | Website improvement commits exist, including `bc0403b`. That does not prove which model produced them. Model execution is not reverified. |

### Public placement receipts

Read-only browser verification on this audit date. No new posts were created.

1. [Product Hunt](https://www.producthunt.com/products/codeink?launch=codeink)
2. [X launch post](https://x.com/codeinkapp/status/2103020703263965347)
3. [r/AppsWebappsFullstack](https://www.reddit.com/r/AppsWebappsFullstack/comments/1wognj8/codeink_one_desktop_workspace_for_my_coding/)
4. [r/sideprojects](https://www.reddit.com/r/sideprojects/comments/1wogcu6/i_built_codeink_to_keep_codingagent_projects_and/)
5. [r/ChatGPTCoding self-promotion thread](https://www.reddit.com/r/ChatGPTCoding/comments/1wm6cbp/comment/pbmqs6e/)
6. [r/github self-promotion thread](https://www.reddit.com/r/github/comments/1jy8rea/comment/pbmj0g7/)
7. [r/LLMDevs](https://www.reddit.com/r/LLMDevs/comments/1wof8z6/i_built_a_free_opensource_desktop_workspace_for/)
8. [r/devtools](https://www.reddit.com/r/devtools/comments/1wodocl/codeink_a_gplv3_desktop_workspace_for_multiple/)
9. [r/SideProject](https://www.reddit.com/r/SideProject/comments/1wodjli/i_built_one_place_for_my_scattered_codingagent/)
10. [r/coolgithubprojects](https://www.reddit.com/r/coolgithubprojects/comments/1wodio3/codeink_opensource_desktop_workspace_for_multiple/)
11. [r/IMadeThis](https://www.reddit.com/r/IMadeThis/comments/1wodhij/i_made_codeink_an_open_source_desktop_home_for/)

## App requirements

The [UI audit](research/ui-audit.md), [desktop audit](research/desktop-audit.md), [agent audit](research/codeink-pi-audit.md) and [performance measurements](research/performance-audit-2026-09-27.md) record source paths, commands and limits. “Verified” below means the stated checks passed, not a universal guarantee.

| Request | Status and evidence |
| --- | --- |
| Claude image attachments and other supported agents | Verified attachment staging and native image payloads through subprocess fixtures, including a Claude image-only prompt through the HTTP bridge. Live authenticated Claude image inference was not repeated. |
| Agent questions and plan modes | Verified question/reply routes for Codex, Claude, OpenCode and Pi, plus protocol-specific plan requests. ACP capabilities remain agent-dependent. |
| Codex experimental API and missing rollout recovery | Verified initialization capability and missing-rollout recovery fixtures. The installed Codex catalog includes Luna; live Luna inference was not run. |
| Switching agents carries context | Implemented and bridge-tested: a new native session receives bounded context and linked source IDs. This audit also preserves the original task when it falls outside recent turns. |
| Handoff summary visible to the user | Inspectable handoff dialog is implemented. It shows the deterministic context extract actually sent. It is not an LLM-written summary and does not include full tool output or old image bytes. |
| Queue and steer | Queue drafts persist in the client and send after idle. Native steering is fixture-tested for supported adapters. Built-in steering now preserves chronology, resolves pending command approval and skips unstarted commands. This is not durable server-side queue admission. |
| Fast conversation loading and bounded tool output | Paged renderer history, lazy tool details and streaming scroll regressions verified. The bridge no longer clones the full history just to admit a prompt. The backend still loads a complete JSON workspace; lazy disk-backed history is not implemented. |
| Several sessions in panes | Implemented with a three-pane limit and separate session routes. See the UI audit for verification scope. |
| Sidebar collapse | Implemented; layout regression tests cover sidebar/topbar transitions. |
| Settings and instructions match sidebar | Implemented with shared neutral surfaces and compact rows. Settings, empty-chat and overview screenshots were inspected. |
| Keep the interface consistent across languages | Fixed missing strings, shifted native menu translations and Punjabi locale detection. Existing translations are retained; 215 app keys and 20 UI keys have an explicit English fallback until translated. Future missing keys still fail the parity test. Four native menu language packs now use CodeInk product branding. |
| Replace all themes and copied sounds | Five CodeInk themes, legacy-theme migration and six generated notification sounds are present. Focused theme/sound tests pass. OpenCode remains a supported external agent. |
| Remove old product branding while keeping OpenCode agent support | Removed the old Go subscription prompt, Zen setup copy, model-provider promotion, retired icons, and automatic logo downloads from OpenCode's model service. The picker keeps existing OpenCode agent models. See the [branding audit](research/branding-audit-2026-09-27.md). |
| Keep promotional popup, introduce built-in agent | Artwork and popup are present. This audit fixes composer focus dismissing the popup and verifies the dialog fits desktop and narrow screens. |
| Topbar-only projects/sessions overview | Covered by layout tests; sidebar mode opens the chat view instead of duplicating the overview. |
| Empty workspace and New Chat centered composer | Verified in both layout modes without projects. Draft sidebar rows were restored in this audit. |
| Initial project, server and branch strip | New-chat context strip is implemented; layout tests cover its presence on new chats and absence on ongoing sessions. No branch is invented for a workspace without a repository. |
| Usage accuracy and OpenUsage research | Direct Claude/Codex paths and OpenUsage's 11-provider schema are covered by fixtures. Fixed freshness, expiry and error handling; added the installed OpenUsage CLI fallback. This does not implement direct credential integrations for every ACP preset. |
| Usage off until explanation and consent | Implemented. Runtime returns before credential probing when disabled, checks consent again between asynchronous phases, and displays the reason for enabling access. macOS can still ask for permission after opt-in. |
| Weekly usage change on completed turns | Implemented as an observed percentage-point change. Tests cover reset-window changes; the runtime omits unsafe values during overlapping CodeInk sessions or late sampling. Other apps using the same account can affect the observed change. |
| macOS menu bar sessions and usage | Implemented native tray plus tested bounds and stale/expired-data handling. Interactive native tray clicks were not exercised in this audit. |
| macOS widgets, “question first” | Feasible via an Apple WidgetKit extension. Not implemented or represented as complete. The menu bar feature is separate. [Apple WidgetKit](https://developer.apple.com/documentation/widgetkit/). |
| Lightweight built-in coding agent | Implemented with AI SDK, lazy imports and one `terminal` tool. Researched Pi's tools, steering, extensions and compaction using first-party docs. Pi's richer extension/compaction features are not claimed as implemented. |
| Vercel AI Gateway and OpenRouter model selection | Key configuration and catalog discovery are implemented. This audit fixes OpenRouter filtering so `tool_choice` alone cannot qualify a model as tool-capable. A free OpenRouter model was exercised live; Vercel inference was not. |
| Agent instructions, bounded retries, context and caching | Regression-tested command order, cancellation, transient retries, permanent errors, steering and request-history trimming. A promoted steer now gets a fresh model-step allowance and keeps unique reply IDs. Stable cache routing and cache counters are implemented; the live free probe reported zero cache hits. Context trimming is heuristic, not token-aware summarization. |
| Test free OpenRouter models and list tools | A free OpenRouter model passed the transport probe and fixed a bug in a temporary Bun project. The independent test changed from failing to passing. The eight-request cap and reviewed commands are recorded in the agent audit. Built-in tool list: `terminal({ command })`. Plan mode exposes no tools. External agents supply their own tools. |
| Fast streaming, tool cards and scrolling up | Four browser regressions pass, including upward scroll retention, dragging the scrollbar and streamed tool output. Production renderer entry shrank from 5.85 MB to 2.92 MB through minification. |
| No new release until explicitly requested | Kept local throughout this audit. |

## Verification

Three GPT-6 Sol subagents ran at extra-high reasoning effort: agent runtime, desktop integrations, and UI. The main agent reviewed their results, fixed the CI coverage gap, measured the production bundle, and checked the launch receipts. All new changes remain uncommitted and unpushed.

| Check | Result |
| --- | --- |
| Desktop `bun run test` | 131 passed, 0 failed, across 27 files. Includes protocol subprocesses, attachments, handoffs, updater metadata, usage, native SQLite persistence, and built-in agent regressions. |
| App `bun run test:unit` | 736 passed, 0 failed, across 105 files. |
| App `bun run test:browser` | 41 passed, 0 failed, across 14 files. These are browser-condition state tests. |
| Session UI `bun run test` | 86 passed, 0 failed. |
| UI `bun run test` | 27 passed, 0 failed. |
| Chromium Playwright | 19 passed, 0 failed, across the new-chat overview, session tab position, streaming/scroll, agent-popup, and model-selection specifications. Two workers, no retries. |
| Package typechecks | Desktop, app, session UI and UI passed. App E2E typecheck passed. |
| Native terminal smoke | Create, stream, single-use authentication, and cleanup passed. |
| Installed catalogs | Read Codex, Claude, OpenCode and Devin model catalogs successfully. Codex includes Luna. This does not run inference. |
| Live free-model evaluation | `cohere/north-mini-code:free` completed a small bug fix in a temporary project and ran the test. An independent check confirmed failing before and passing afterward. No real project edits or paid model calls. |
| Production desktop build | Passed. Renderer entry minification reduced the entry from about 5.85 MB to 2.92 MB. This measures bundle bytes, not whole-app memory or latency. |
| Workflow and whitespace checks | Both edited workflow YAML files parsed, and `git diff --check` passed. The expanded CI gates are local and have not run on GitHub yet. |

The local workflows now run full desktop and app tests, session UI and UI tests, package typechecks, E2E typecheck, and the five relevant Chromium specifications. Previously CI skipped the new desktop `src/main` tests and ran only five app test files.

### Remaining limits

- The built-in agent stays small: one terminal tool, bounded command output, sequential commands, transient retries, and explicit approvals. It has no built-in subagent or interactive question tool. Plan mode produces text without tools.
- Handoff uses a visible bounded context extract. Long-context trimming is heuristic. Neither is an LLM-generated summary. The backend still loads complete workspace JSON; renderer pagination does not remove that memory floor.
- Usage from other providers depends on an available OpenUsage API or installed CLI. Weekly percentage change is an observed account delta, not exact per-turn billing. Cache counters worked, but the live free-model probes reported zero cache hits.
- External-agent behavior is covered by protocol fixtures and real catalog reads, not authenticated inference for every agent. Windows/Linux installers, an actual installed-app replacement, and native macOS tray clicks were not exercised in this audit.
- The original localhost session was no longer running. UI checks used isolated browser fixtures. Product Hunt's cited Dren reply could not be verified. macOS widgets were only a feasibility question and remain unimplemented.

These results support the specific fixes and workflows above. They do not establish that every provider, platform, model or workspace size is bug-free.
