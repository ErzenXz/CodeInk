import { defineConfig } from "electron-vite"
import appPlugin from "@codeink/app/vite"
const nodePtyPackage = `@lydell/node-pty-${process.platform}-${process.arch}`

export default defineConfig({
  main: {
    define: {
      "import.meta.env.CODEINK_CHANNEL": JSON.stringify(
        process.env.CODEINK_CHANNEL === "early-access"
          ? "beta"
          : process.env.CODEINK_CHANNEL === "dev"
            ? "dev"
            : "prod",
      ),
    },
    build: { rollupOptions: { input: { index: "src/main/index.ts" } }, externalizeDeps: { include: [nodePtyPackage] } },
    plugins: [
      {
        name: "desktop:node-pty",
        enforce: "pre",
        resolveId(id) {
          if (id === "@lydell/node-pty") return nodePtyPackage
        },
      },
    ],
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: "src/preload/index.ts" },
        output: { format: "cjs", entryFileNames: "[name].js" },
      },
    },
  },
  renderer: {
    plugins: [appPlugin],
    publicDir: "../../../app/public",
    root: "src/renderer",
    build: { rollupOptions: { input: { main: "src/renderer/index.html" } } },
  },
})
