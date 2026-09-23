# Upstream source

- Repository: https://github.com/anomalyco/opencode
- Revision: `fe3f3a41f79ad292cc3c7c629567385a20ec5130`
- Upstream package version: `1.18.32`
- Retrieved: 2026-09-22
- CodeInk branches: `main` (Production), `development` (Early Access)
- Git remote: `upstream`

The exact source revision is recorded above. The imported OpenCode material retains its original MIT notice in [licenses/UPSTREAM-MIT.txt](licenses/UPSTREAM-MIT.txt) and `packages/ui/LICENSE`. The current combined CodeInk distribution is offered under GPL-3.0-or-later; see [LICENSE-NOTICE.md](LICENSE-NOTICE.md). The public CodeInk repository starts with a desktop-only snapshot; the full upstream history remains available in the upstream repository. CodeInk is an independent fork.

## Retained desktop sources

- `packages/desktop`: original Electron main process, preload, renderer entry, native integration, and icons, with bundled sidecar startup replaced by the local agent bridge.
- `packages/app`: original Solid application. Agent configuration replaces the provider OAuth/API-key dialogs; platform capabilities, provider catalog preferences, and English connection copy are adjusted. Original page and layout structure is retained; product branding and help destinations are changed to CodeInk.
- `packages/ui`, `packages/session-ui`, `packages/schema`: upstream components, styles, schemas, and their required assets.
- `packages/core`: only the five browser utility modules imported by the UI (`array`, `binary`, `encode`, `path`, `retry`).
- `packages/sdk/js`: generated HTTP client and wire types. Server launchers and CLI spawning entrypoints are removed.

Other monorepo products, CLI/server implementations, release infrastructure, and unrelated packages are removed from the working tree. Generated clients and browser utilities are retained because the original UI imports them; they do not contain the OpenCode agent runtime.

## Connection boundary

`packages/desktop/src/main/bridge.ts` implements the original frontend's HTTP/SSE contract. It translates to the session manager and external protocol adapters in `packages/desktop/src/main/adapters`. Native terminals are handled by `terminals.ts`. The renderer still uses its original SDK and components.

The application bundle includes Electron, the original web UI, native terminal support, and this connection layer. It does not include coding-agent executables. No account login or API-key storage is added to the desktop bridge.

## UI and branding

The desktop began with the upstream layout, composer, timeline, file/review panels, and theme palettes. CodeInk has since changed parts of that UI and replaced the original product name and logos. See [BRAND.md](BRAND.md) for the icon and regeneration instructions. Upstream copyright, license notices, and source attribution are preserved.
