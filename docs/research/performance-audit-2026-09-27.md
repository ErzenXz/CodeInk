# Performance audit, September 27, 2026

Measurements are local samples on this Mac, using Bun 1.3.14 and Node 24.19.0. They do not predict whole-app latency on every device.

## Production JavaScript

The installed `electron-vite` config defaults renderer minification to `false`. CodeInk inherited that default. `packages/desktop/electron.vite.config.ts` now enables esbuild minification for the production renderer.

| Build | Renderer entry |
| --- | ---: |
| Before | 5,852.31 kB |
| Final audited build | 2,919.88 kB |

The entry is about 50% smaller. Both production builds succeeded. The first minified build was 2,916.30 kB; the final build includes the subsequent localization repairs. This reduces bytes loaded and parsed; it is not evidence of a 50% reduction in memory or startup time. The agent SDK remains outside the renderer, and gateway code is imported only when needed in the desktop process.

Reproduce with `bun run build` from `packages/desktop`. See the output for `out/renderer/assets/main-*.js`. The full renderer still includes large lazily loaded language grammars and a terminal module. Build size alone does not measure whether those modules are active.

## Workspace persistence

`bun scripts/benchmark-store.ts` from `packages/desktop` measured 24 sessions, 120 messages per session, and 24 concurrent save requests:

| Measurement | Sample |
| --- | ---: |
| Enqueue time | 0.385 ms |
| Zero-delay timer latency | 1.216 ms |
| Total save time | 2.214 ms |

The batching improvement was implemented previously and still passes the concurrent-save tests. The renderer receives paged conversation history and streamed updates for the active turn. External coding agents run in separate processes, and the existing concurrency test runs eight independent sessions.

Prompt admission also used to clone the full session, including historical tool output, even though the HTTP bridge discarded the result. The bridge now opts out of that snapshot. A regression sends through the real bridge with a noncloneable historical tool value and verifies admission succeeds. Other callers retain the snapshot behavior they requested.

The workspace store still loads its complete persisted JSON and retains session histories in the desktop process. Very large workspaces therefore have a memory floor that UI pagination does not remove. A lazy history store or database migration would need explicit migration/recovery tests before shipping. This audit does not claim that migration is implemented.

## Browser behavior

The regression suite checks that scrolling upward and dragging the scrollbar retain the user's position during a stream, that tool output remains usable, and that newer output is visible when following the bottom. The final counts and commands are in [the UI audit](ui-audit.md).

These checks cover the reported scroll and rendering failures. They do not establish a universal “no lag” guarantee or a comparison against other coding applications.
