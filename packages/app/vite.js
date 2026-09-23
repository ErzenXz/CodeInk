import { readFileSync } from "node:fs"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"

const theme = fileURLToPath(new URL("./public/codeink-theme-preload.js", import.meta.url))

const channel = (() => {
  if (process.env.CODEINK_CHANNEL === "early-access") return "beta"
  if (process.env.CODEINK_CHANNEL === "production") return "prod"
  return "dev"
})()

/**
 * @type {import("vite").PluginOption}
 */
export default [
  {
    name: "codeink-desktop:config",
    config() {
      return {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
          },
        },
        define: {
          "import.meta.env.VITE_CODEINK_CHANNEL": JSON.stringify(channel),
        },
        worker: {
          format: "es",
        },
      }
    },
  },
  {
    name: "codeink-desktop:theme-preload",
    transformIndexHtml(html) {
      return html.replace(
        '<script id="codeink-theme-preload-script" src="/codeink-theme-preload.js"></script>',
        `<script id="codeink-theme-preload-script">${readFileSync(theme, "utf8")}</script>`,
      )
    },
  },
  tailwindcss(),
  solidPlugin(),
]
