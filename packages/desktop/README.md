# CodeInk Desktop

The original OpenCode Electron application, with external coding-agent connections.

See the [repository README](../../README.md) for setup, protocol support, build instructions, and current limitations. The original application UI lives in `../app` and uses the original components in `../ui` and `../session-ui`.

```sh
bun dev
bun typecheck
bun test src/test
bun run build
bun run package
```
