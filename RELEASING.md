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

Without signing secrets the pipeline creates unsigned installers, clearly described in the release notes and website. macOS and Windows may display security warnings. Checksums verify download integrity; they are not publisher identity verification. In-app automatic updating stays disabled until signed update delivery is configured and tested.

To enable platform signing, add repository Actions secrets:

- `CSC_LINK`, `CSC_KEY_PASSWORD`: base64 Apple Developer ID Application certificate (`.p12`) and password.
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`: Apple notarization credentials.
- `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`: Windows code-signing certificate and password, where supported by your certificate provider. Hardware/cloud-based signing requires configuring the provider's signing integration instead.

Certificate enrollment, signing credentials, a custom domain, and DNS are account-owner steps; none are stored in source. Never put credentials into the workflow or commit them. The repository token used for releases has only `contents: write` and exists only in the publish job.

## Download website

The static site lives in `website/` and deploys from `main` through GitHub Pages. It is available at https://erzenxz.github.io/CodeInk/. Enable Pages with **Source: GitHub Actions**. Both channel tabs fetch public GitHub Releases; errors provide a direct Releases link rather than a broken download. Website updates do not rebuild desktop installers.

## Before a release

Run the desktop regression suite and type check, the changed frontend tests, a build, and the native fixture UI. Verify commands, read paths, approvals, chronology, context numbers, cancellation, and model switching. CI additionally verifies Linux terminal behavior and packages on every supported runner. Protocol fixtures do not call paid model services. Agent/version compatibility varies; the 22 ACP presets are not claims that every agent version has been tested live.

The Context panel reports agent-provided values. Historical sessions from versions that discarded usage cannot be reconstructed exactly; they retain unknown statistics. Historical ACP text already concatenated across tools cannot be reliably split after the fact. New turns preserve the correct order. Stored tool input fields are normalized for display without rewriting the original history.

## License and privacy

The MIT license permits redistribution and modification, with its copyright and permission notices retained. CodeInk credits Erzen Krasniqi for this fork's changes and retains OpenCode's copyright. Packaged applications include the license, upstream provenance, font licenses, agent icon sources, generated dependency license notices, and Electron's own notices. Product and agent trademarks remain with their respective owners.

CodeInk has no cloud account of its own. The bridge stores session data locally; the selected agent controls model-provider network traffic. Debug logs are local and can contain project paths and diagnostic data. Review exported logs before attaching them to public issues.
