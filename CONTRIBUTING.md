# Contributing to CodeInk

Thanks for helping improve CodeInk. Bug reports, documentation fixes, accessibility improvements, platform testing, and focused code changes are welcome.

Please read the [Code of Conduct](CODE_OF_CONDUCT.md) and [license notice](LICENSE-NOTICE.md) before contributing. By submitting a contribution, you confirm you have the right to submit it and agree that your contribution to CodeInk may be distributed under `GPL-3.0-or-later`. Keep copyright and license notices on code imported from elsewhere, and identify the source and license of any new third-party material.

## Before opening a pull request

1. Search [existing issues](https://github.com/ErzenXz/CodeInk/issues) and pull requests for the same change.
2. For a bug, include the CodeInk version and channel, operating system, agent and CLI version, steps to reproduce, expected behavior, and actual behavior. Remove API keys, tokens, project secrets, and private file contents from logs and screenshots.
3. For a larger feature, open an issue first so maintainers and contributors can agree on the behavior and scope.
4. For a vulnerability, use [SECURITY.md](SECURITY.md). Do not publish exploit details in an issue.

## Development setup

CodeInk uses Bun 1.3.14. Native desktop builds also require the platform toolchain used by Electron. Install dependencies at the repository root:

```sh
bun install --frozen-lockfile
bun dev
```

Run checks from the package you changed:

```sh
cd packages/desktop
bun typecheck
bun test src/test
bun run build
```

For app tests, use `cd packages/app` and `bun test --conditions=solid <test-file>`. For UI packages, run `bun typecheck` inside that package. Do not run tests from the repository root. See the applicable `AGENTS.md` files for architecture, style, and package-specific instructions.

## Branch and pull request workflow

- Base pull requests on `development`. `main` is the Production release branch; `development` is Early Access.
- Keep branches short: at most three hyphen-separated words, with no slash or type prefix.
- Use conventional commit-style titles such as `fix(desktop): handle missing agent` or `docs: clarify installation`.
- Keep changes focused. Describe the problem, approach, how you tested it, and any user-visible limitation.
- Add or update tests when they can reproduce a real behavior change. Avoid tests that only repeat implementation details.
- Preserve upstream attribution and generated-code boundaries. Do not hand-edit generated SDK files; follow `AGENTS.md` for regeneration commands.

Release builds run on macOS, Windows, and Linux. A local test on one platform is useful, but it does not replace the release matrix for native packaging. Maintainers may ask for changes or decline a proposal to keep the product focused.

## Documentation and design

Write for someone installing CodeInk for the first time. Describe what the app does, which agent owns a capability, and how to verify an instruction. Avoid promising support for an agent or platform that has only a launch preset or untested path. Update the README, [agent guide](AGENT-SOURCES.md), [support guide](SUPPORT.md), or [release guide](RELEASING.md) when behavior changes.
