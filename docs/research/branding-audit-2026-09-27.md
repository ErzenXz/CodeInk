# CodeInk branding audit

The user asked to keep OpenCode as an external agent connection and remove its old product and model-provider promotion from CodeInk. This audit covers the app, desktop package, website, translated copy, and bundled icons. All changes remain local.

## Changed

- Removed the old Go subscription popup and its translated copy. Retry and limit status still appears in session messages.
- Removed Zen setup text, links, provider recommendations, and the old provider logos from the model and settings UI. The bundled CodeInk Agent and external agent connections remain available.
- Free-model labels now require a reported zero input and output price. They no longer assume a model is free because it came from one provider.
- The model picker and Manage Models hide the retired `opencode-go` subscription. They keep models from the `opencode` provider, which existing OpenCode agent sessions still use, and retain the `local-opencode` agent connection.
- Replaced model-picker text and generic error/plugin copy that named `opencode.json`. The 61 non-English dictionaries use explicit English fallbacks for changed text until it is translated. Removed unused subscription strings from all 62 UI dictionaries.
- Removed the UI icon build's automatic fetch from `models.opencode.ai`. Provider icons now come from the checked-in assets. Removed the retired provider logos while retaining the OpenCode agent icon.
- Updated the desktop package README to describe CodeInk.

## Names that remain intentionally

- `OpenCode` appears where CodeInk lists the supported external agent or explains how to install and run its actual CLI in WSL.
- `opencode` appears in protocol IDs, executable names, HTTP headers, and old data keys required to connect that agent or read existing workspaces.
- The original upstream name and MIT notice remain in [LICENSE-NOTICE.md](../../LICENSE-NOTICE.md), [UPSTREAM.md](../../UPSTREAM.md), and the release resources. Those notices record the origin and license of retained code.

The website and repository README mention OpenCode only as a supported agent. Neither promotes the retired Go or Zen model service.

## Verification

The full app unit suite passed 736 tests, app browser state tests passed 41, and the UI suite passed 27. A Chromium model-selection flow verifies that CodeInk Agent and external agent models remain selectable while the retired subscription is absent from both the picker and Manage Models. The combined Chromium gate passed all 19 tests with two workers and no retries. App, UI, and browser test typechecks passed. The desktop production build passed. The release and check workflow YAML parsed.
