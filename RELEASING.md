# Releasing CodeInk

CodeInk is maintained by Erzen Krasniqi. App source, installers, releases, and the website are public in `ErzenXz/CodeInk`.

## Branches and channels

| Branch | Channel | Installed application | Release |
| --- | --- | --- | --- |
| `main` | Production | CodeInk | Normal GitHub Release; marked latest |
| `development` | Early Access | CodeInk Early Access | GitHub prerelease |

Push code to either branch to run tests, type checking, native platform builds, and release publishing. A failed check or platform build prevents publication. The website always reads the most recent published release for each channel. Documentation-only changes skip desktop packaging. Use **Actions → Desktop releases → Run workflow** on the desired branch to build manually.

Production and Early Access have separate app IDs and data folders and can be installed together. Development runs use CodeInk Dev. Your installed agent's own credentials and native sessions remain under that agent's control. No coding agent is bundled.

## Platforms

- macOS: native Apple Silicon and Intel runners; `.dmg` and `.zip`.
- Windows: x64 NSIS installer; native Windows runner.
- Linux: native x64 and ARM64 runners; `.AppImage` and `.deb`.

Windows ARM64 is not currently shipped. GitHub-hosted matrix jobs use the lockfile and Bun 1.3.14. Main, preload, and renderer bundles are rebuilt on each platform so native terminal dependencies match the installer. Artifacts are uploaded privately within Actions until all jobs pass; then the complete release is published with `SHA256SUMS.txt` and `manifest.json`. No partial channel release is advertised.

## Versions

The root `package.json` is the base semantic version. CI adds the `Desktop releases` workflow run number to its patch component. With base `0.1.0`, run 12 produces Production `0.1.12` or Early Access `0.1.12-early-access`. This produces a unique, increasing version per push without a bot commit loop. Increment the major/minor base for a new version series. CI changes only its temporary desktop package manifest. Tags refer to the exact tested source commit. Published releases are immutable: make a new push to publish a correction.

## Signing

macOS releases require an Apple Developer ID Application signature and notarization. The workflow fails before packaging if any required Apple credential is missing, and verifies the app's Developer ID signature, stapled notarization ticket, and Gatekeeper assessment before uploading it. The `v0.1.16` production and `v0.1.15-early-access` macOS assets predate this gate and can show a misleading “damaged” warning; do not recommend them for macOS. The Account Holder must create the Developer ID certificate and accept any pending Apple Developer agreement. Windows installers may still show SmartScreen until Windows signing is configured. Checksums verify download integrity; they are not publisher identity verification. The in-app update check reads CodeInk GitHub releases for its own channel and opens the CodeInk download page when a newer build exists. It does not install updates in place. Older builds with the disabled updater need one manual download.

To enable platform signing, add repository Actions secrets:

- `CSC_LINK`, `CSC_KEY_PASSWORD`: base64 Apple Developer ID Application certificate (`.p12`) and password.
- `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`: a dedicated App Store Connect team API key with the Developer role, encoded as a one-line base64 secret, plus its key ID, issuer ID, and team ID. The workflow writes the key to its temporary runner directory for notarization.
- `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`: Windows code-signing certificate and password, where supported by your certificate provider. Hardware/cloud-based signing requires configuring the provider's signing integration instead.

Certificate enrollment and signing credentials are account-owner steps; none are stored in source. Never put credentials into the workflow or commit them. The repository token used for releases has only `contents: write` and exists only in the publish job.
When exporting a `.p12` with OpenSSL 3, use PKCS#12 algorithms accepted by macOS Keychain (for example `openssl pkcs12 -export -legacy -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1`) and test importing it in a temporary keychain. The workflow installs Apple's public Developer ID G2 intermediate certificate before packaging.

## Download website

The static site lives in `website/` and deploys automatically through the connected Vercel GitHub integration. `main` updates production; other branches receive preview deployments. Its canonical URL is https://www.getcode.ink/; `https://getcode.ink/` redirects there. The Vercel project is `codeink` in `erzenxzs-projects`, with Root Directory `website`, framework `Other`, no install/build command, and Output Directory `.`. The former `codeink-desktop.vercel.app` address remains an alias. No Vercel token is stored in GitHub Actions. Both channel tabs fetch public GitHub Releases; errors provide a direct Releases link rather than a broken download. Website updates do not rebuild desktop installers.

## Before a release

Run the desktop regression suite and type check, the changed frontend tests, a build, and the native fixture UI. Verify commands, read paths, approvals, chronology, context numbers, cancellation, and model switching. CI additionally runs real protocol subprocesses and a native terminal smoke test on every supported runner before packaging. Protocol fixtures do not call paid model services. Agent/version compatibility varies; the 22 ACP presets are not claims that every agent version has been tested live.

The Context panel reports agent-provided values. Historical sessions from versions that discarded usage cannot be reconstructed exactly; they retain unknown statistics. Historical ACP text already concatenated across tools cannot be reliably split after the fact. New turns preserve the correct order. Stored tool input fields are normalized for display without rewriting the original history.

## License and privacy

The current CodeInk distribution is GPL-3.0-or-later, with the upstream OpenCode MIT notice preserved in `licenses/UPSTREAM-MIT.txt`. Earlier CodeInk MIT releases keep their previously granted permissions. Packaged applications include the GPL text, upstream provenance and MIT notice, font licenses, agent icon sources, generated dependency license notices, and Electron's own notices. Each GitHub release tag exposes the corresponding source archive. Product and agent trademarks remain with their respective owners. See [LICENSE-NOTICE.md](LICENSE-NOTICE.md).

CodeInk has no cloud account of its own. The bridge stores session data locally; the selected agent controls model-provider network traffic. Debug logs are local and can contain project paths and diagnostic data. Review exported logs before attaching them to public issues.
