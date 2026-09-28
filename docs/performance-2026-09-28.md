# History memory and responsiveness

Saved transcripts previously lived in the desktop process for every chat, and every save serialized the entire workspace. Histories now live in separate content-addressed files. Startup, sidebar listing, attachment lookup, and usage summaries use the small workspace index. Opening a chat loads its history; clean idle histories use a four-chat, 16 MiB cache. Running chats, approvals, and unsaved edits are preserved.

The renderer retains eight recent session histories instead of forty, with an approximate 16 MiB budget. Active sessions and outstanding requests remain protected. Cached Markdown text and highlighted HTML now have an 8 MiB budget in addition to their entry cap. Completed native turns release their message indexes.

## Local measurements

Run `bun scripts/benchmark-history.ts` from `packages/desktop`. It writes 100 chats with 100 messages each, then starts a separate Bun process to measure loading, sidebar projection, and saving one additional reply. The fixture includes distinct source-like text per message. These measurements use Bun 1.3.14 on this Mac; they do not measure total packaged Electron memory or external agent processes.

| Measurement | Before | After, representative sample |
| --- | ---: | ---: |
| RSS growth after loading and listing histories | 119.3 MB | 5.7 MB |
| History load | 78.9 ms | 18.2 ms |
| Sidebar projection of 100 chats | 3.2 ms | 0.8 ms |
| One-reply save | 147.5 ms | 13.7 ms |
| Zero-delay timer during that save | 129.3 ms | 5.2 ms |

Additional after-change samples showed RSS growth of 3.4–5.7 MB and load times of 14–61 ms. The final sample after the cache regression fix reported 3.9 MB RSS growth, 35.4 ms loading, 37.6 ms saving, and 7.7 ms timer delay. These are diagnostic samples rather than statistical latency guarantees. Most of the memory reduction comes from avoiding allocation of unopened transcripts. The JavaScript heap counter alone misses much of Bun's string backing storage, so the benchmark reports both heap and RSS growth.

`CODEINK_BENCH_NODE=1 bun scripts/benchmark-history.ts` also exercises the bundled implementation under Node/V8. A local after-change sample reported 3.6 MB RSS growth, 0.44 MB retained heap growth, a 15.4 ms load, and 3.4 ms timer delay during saving. It has no matching Node baseline and is a runtime compatibility check, not a before/after Electron measurement.

## Concurrent agents and live checks

Run `bun scripts/benchmark-agents.ts` from `packages/desktop` for the local stress test. It seeds 100 saved histories and starts 12 simultaneous sessions: four Codex protocol peers, four Claude protocol peers, and four real CodeInk adapters against a local SSE gateway. The protocol peers run in child processes; no external model calls occur. Each produces 100 chunks totaling approximately 100 KB per turn. All sessions completed both cold and warm waves, and all 112 saved histories remained readable after reloading.

| Local wave | Completion of all 12 sessions | Timer gap p95 | Maximum timer gap |
| --- | ---: | ---: | ---: |
| Cold | 3.21 s | 99.2 ms | 379.4 ms |
| Warm | 2.06 s | 32.7 ms | 153.1 ms |

This verifies concurrency and persistence under load, not a speedup relative to a previous multi-agent baseline. Cold startup and occasional main-process work still cause noticeable gaps. The test excludes external CLI startup and provider latency.

One authorized live HELLO was sent through each installed Codex and Claude CLI, with tools prohibited. Both returned five-character replies. First text arrived at 20.2 s and 20.6 s respectively. No further live model requests were made. `bun scripts/benchmark-agent-startup.ts` separately measures protocol initialization without a model turn: Codex initialized in 2.23 s and Claude in 11.78 s. Model response time and external CLI startup remain outside these history/cache improvements.

Native agents already run in separate processes, while CodeInk agents make concurrent asynchronous requests. No additional worker threads or shared agent process pool were introduced. Idle native adapters remain retained for fast subsequent turns; their process memory is not included in the history-memory reduction.

## Production renderer checks

Production tab-switch benchmarks showed no blank, incorrect, or replaced timeline frames. Hot switching measured 3.8 ms to correct content with the review pane closed and 5.4 ms with it open; the corresponding before samples were 3.8 ms and 24.7 ms. Single samples do not establish a statistical speedup. Four streaming/scroll regressions passed, including scroll-up preservation, dragging, large chunks, and tool-row retention.

With 320 historical turns and 40 streamed deltas at normal CPU speed, frame gaps were 9.3 ms p95 and 25.2 ms maximum, with no long tasks, no row replacements, no blank samples, and no pending deltas. Completion took 11.5 s because the test fixture closes SSE after every event and the client waits 250 ms between reconnections. This is not a production provider-response measurement.

The default 160-delta benchmark under 30× CPU throttling timed out at 420 s; a normal-CPU 160-delta run also exceeded its 45 s deadline while making progress. Its per-event reconnect behavior imposes roughly 40 s of delivery delay before processing overhead. The reduced normal-CPU check passed, but the default extreme benchmark remains unverified.

## Persistence and recovery

The workspace index is version 2. An existing inline-history workspace migrates once and keeps the original bytes in `agents.json.legacy` (or the equivalent filename). History files live in `agents.json.history`. They are written atomically before replacing the index. Failed index writes retain the previous readable histories. Replaced histories are removed only after the new index commits. Content checksums and the message schema validate histories when opened; missing files fail startup rather than becoming empty conversations.

Backups must include the workspace index and its `.history` directory together. Older builds cannot read the version 2 index; the `.legacy` file contains the pre-migration workspace, not subsequent chats. Initial migration still reads the old full workspace once. A very large open transcript still loads and serializes in full; incremental storage within an individual transcript remains future work.

## Validation

Regression coverage exercises migration, interrupted sessions, concurrent saves, failed index commits and orphan cleanup, corrupt/missing histories, cache eviction, dirty/running session preservation, and metadata-only usage/attachment access. A regression also verifies that schema normalization of object-field order does not incorrectly keep clean histories resident. Renderer tests cover byte-budget eviction and Markdown replacement accounting. Existing provider, retry, history pagination, and streaming tests also run against these changes.

Desktop, app, session-ui, and ui package typechecks pass, as does app E2E type checking. Release preparation fixed the two missing workspace labels through the existing explicit English fallback list. The full app suite now passes 737 unit tests and 41 browser tests. Desktop passes 155 tests, session-ui passes 88, and ui passes 27. Desktop and app production builds pass; release preparation also rebuilt the complete desktop bundle and passed the native terminal smoke check.
