# CodeInk identity

The CodeInk application keeps the upstream desktop layout and uses its own name, wordmark, splash mark, notification icon, favicons, and native application icons.

- Master artwork: `packages/ui/src/assets/brand/codeink-icon.png`
- Desktop formats: `packages/desktop/icons/codeink` (PNG, ICNS, and multi-size ICO)
- Web formats: `packages/ui/src/assets/favicon`
- Wordmark components: `packages/ui/src/components/logo.tsx` and `packages/ui/src/v2/components/wordmark-v2.tsx`

The master was generated with the built-in **image_gen** tool on 2026-09-22. The original image is retained in the workspace. Native icon formats are resized/encoded from that master with `bun run icons:generate` in `packages/desktop` (macOS `sips` and `iconutil` required only for regeneration). Normal builds use the committed icon formats.

The image uses a warm-white geometric C with a fountain-pen nib on an ink-colored rounded tile. Product-name replacements preserve surrounding translations. Protocol identifiers, independently installed agent names, and upstream license notices retain their original names.

## Generation prompt

```text
Use case: logo-brand.
Asset type: production desktop application icon for CodeInk, a coding-agent workspace.
Create one polished, original, minimal icon: a bold warm-white geometric C whose lower-right terminal becomes a simple fountain-pen nib, with a small negative-space nib slit. The symbol must read as a single memorable silhouette, recognizable at 16 and 32 pixels. Center the symbol on a near-black ink-colored rounded-square tile. Clean precise vector-like edges, flat colors, strong negative space, subtly softened corners, restrained premium developer-tool identity.
Composition: square 1024 by 1024 image; rounded tile occupies approximately 82% of the canvas with equal transparent outer padding; symbol occupies roughly 58% of tile width. Genuine transparent pixels outside the tile. Front view, no perspective.
No words, no letters other than the abstract C mark, no code brackets, no existing OpenCode logo, no watermark, no mockup, no environment, no border, no drop shadow, no glow, no glossy 3D effect. Deliver a single finished icon.
```
