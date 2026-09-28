# Desktop agent runtime audit (2026-09-27)

This records the evidence for the external-agent and usage paths. It distinguishes subprocess fixture coverage from authenticated provider behavior. This part of the audit sent no live external-agent inference request or usage-account lookup. The separate [built-in agent audit](codeink-pi-audit.md) records its live OpenRouter free-model probes. No credential dump, installed-app restart, commit, push, or release was performed.

| Request | Evidence and result | Limit |
| --- | --- | --- |
| Image attachments across agents | `src/test/protocols.test.ts` sends a real PNG through Codex, Claude, OpenCode, and Pi fixture subprocesses, including image-only turns. `src/test/bridge.test.ts` sends a data URL through the HTTP bridge into Claude's native image block. | Actual authenticated provider responses were not tested. ACP image support depends on the connected ACP agent's capabilities. |
| Questions and plan modes | `src/test/bridge.test.ts` exercises Codex, Claude, OpenCode, and Pi question responses through desktop SDK routes. `src/test/protocols.test.ts` checks Codex `collaborationMode`, Claude `--permission-mode plan`, and OpenCode plan agent wire requests. | Actual provider acceptance is not established by fixtures. |
| Codex protocol and missing rollout | `src/test/protocols.test.ts` asserts `experimentalApi: true` at initialize and tests recovery from a missing native thread while retaining saved conversation context. | Recovery starts a new native thread, so the provider's hidden old thread state is unavailable. |
| Handoff to another agent | `src/test/handoff.test.ts` checks bounded context, preservation of the original request plus recent turns, and omission of tool outputs. `src/test/bridge.test.ts` verifies handoff context reaches the new agent without being added to the visible user message. The destination session stores the source IDs and context for inspection. | Handoff is a bounded text digest, not a model-generated summary or a full transcript. The destination agent must inspect current files before acting. |
| Queue and steer | `src/test/bridge.test.ts` checks a native Codex steer is admitted once. The app stores queue drafts client-side and dispatches when idle (`src/components/prompt-input/submit.test.ts` in the app package). | Desktop bridge does not durably admit queued requests while a turn is running. Queue drafts depend on client state until sent. |
| Usage and privacy | `readInstalledAgentUsage` returns before probing when monitoring is off; the production bridge receives the opt-in predicate. The bridge fixture defaults to disabled, avoiding Electron store and credential reads. Native Codex rate limits use app-server; Claude reads an existing login only after opt-in. OpenUsage is read via its loopback API or installed one-shot CLI only after opt-in. | The optional OpenUsage helper must be installed for its provider coverage if the app is not running. External Keychain prompts depend on macOS. No live account was queried in this audit. |
| Weekly change per turn | `src/main/weekly-delta.test.ts` verifies same-window percentage-point subtraction and rejects changed reset windows. The bridge suppresses attribution when overlapping CodeInk sessions share a provider family and when sampling misses the first output. | The value is an observed account quota change, not exact per-turn consumption if another process uses the same account. It is omitted when attribution is unsafe. |
| macOS menu bar | `src/main/menu-bar-model.test.ts` checks running session limits, quota expiry, and stale values. `menu-bar.ts` subscribes to session status and opt-in usage changes and opens selected sessions. | No interactive macOS tray click test was run; Electron UI requires the packaged app. |
| Admission cost on long transcripts | `src/test/bridge.test.ts` inserts a noncloneable historical tool payload and confirms prompt admission succeeds. The HTTP bridge requests no session snapshot, avoiding a full `structuredClone` of history that it discards. | Workspace persistence still serializes session history; larger storage changes need a separate design. |

## OpenUsage contract

The upstream [local HTTP API](https://github.com/robinebers/openusage/blob/main/docs/local-http-api.md) defines `GET /v1/limits` with schema `openusage.limits.v1`, per-provider `stale`/`expiresAt`, bounded consumption, balances, and refresh errors. Its [CLI](https://github.com/robinebers/openusage/blob/main/docs/cli.md) prints the same envelope and can run without the menu bar app. CodeInk parses that envelope, marks expired data stale, and falls back to the helper only if the loopback API is unavailable or malformed. The upstream resource contract covers Antigravity, Claude, Codex, Copilot, Cursor, Devin, Grok, Ollama, OpenCode, OpenRouter, and Z.ai. CodeInk does not claim live data for providers absent from the current envelope.

## Verification commands

Run from `packages/desktop`:

```sh
bun test src/test/bridge.test.ts src/test/handoff.test.ts src/main/openusage.test.ts src/main/menu-bar-model.test.ts
bun typecheck
```

The focused tests and typecheck passed on this checkout. The installed agent catalogs were probed separately by the integration audit; they do not exercise authenticated inference. The broad `bun run test` command now includes `src/main` tests and runs the SQLite draft-store fixture in Node.js 24, matching Electron's native SQLite API.
