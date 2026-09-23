# Desktop concurrency and responsiveness check

The desktop already starts each coding agent as a separate CLI process. Eight independent agent sessions completed concurrently in the desktop integration test, including native approval handling and restored histories. Worker threads would not make the external agent processes more parallel. The measured bottleneck was repeated synchronous serialization of the entire local workspace on the Electron main process.

## Changes

- Agent event bursts across all sessions now share one 50 ms persistence window, while each changed session still receives its IPC update.
- Saves requested together share one serialization and atomic file write. Later changes queue another snapshot, preserving the latest state.
- Historical message projection reuses deterministic part IDs for unchanged message objects. The `WeakMap` cache releases entries with their messages.

The workspace store remains a single JSON file. Very large histories still require a full snapshot and could eventually justify an append-only or database-backed store. That is a separate migration because durability and recovery semantics matter more than speculative parallelism.

## Reproduction

From `packages/desktop`, run `bun scripts/benchmark-store.ts`. The fixture has 24 sessions with 120 messages each and requests 24 saves at once. On the same Apple Silicon machine and Bun 1.3.14, before the save change, enqueueing took 19–25 ms, the zero-delay timer ran after 19–25 ms, and all writes finished in 56–66 ms. After the change, enqueueing took 0.1–0.4 ms, the timer ran after 1.2–1.4 ms, and all writes finished in 2–4 ms. These are small local samples, not a whole-app latency guarantee.

The 24-session history projection took about 11.1 ms cold; repeated projection with cached IDs took about 0.64 ms. The test suite also verifies eight simultaneous agent sessions and that overlapping saves retain the latest state. Run `bun typecheck` and `bun test src/test` from `packages/desktop` for the regression checks.
