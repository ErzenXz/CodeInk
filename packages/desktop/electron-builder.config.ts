import type { Configuration } from "electron-builder"
const early = process.env.CODEINK_CHANNEL === "early-access"

export default {
  appId: early ? "app.codeink.desktop.early-access" : "app.codeink.desktop",
  productName: early ? "CodeInk Early Access" : "CodeInk",
  artifactName: `codeink-${early ? "early-access" : "production"}-\${version}-\${os}-\${arch}.\${ext}`,
  directories: { output: "dist" },
  files: ["out/main/**/*", "out/preload/**/*", "out/renderer/**/*", "package.json"],
  extraResources: [
    { from: "resources/icons", to: "icons", filter: ["*.png", "*.ico", "*.icns"] },
    { from: "resources/help", to: "help" },
    { from: "../../LICENSE", to: "LICENSE" },
    { from: "../../UPSTREAM.md", to: "UPSTREAM.md" },
    { from: "../../AGENT-SOURCES.md", to: "AGENT-SOURCES.md" },
    { from: "resources/THIRD-PARTY-NOTICES.txt", to: "THIRD-PARTY-NOTICES.txt" },
    { from: "../../licenses", to: "licenses" },
  ],
  publish: null,
  npmRebuild: false,
  asar: true,
  mac: {
    icon: "resources/icons/icon.icns",
    category: "public.app-category.developer-tools",
    target: ["dmg", "zip"],
    forceCodeSigning: true,
    hardenedRuntime: true,
    entitlements: "resources/entitlements.mac.plist",
    entitlementsInherit: "resources/entitlements.mac.plist",
    // Apple can hold a submission longer than a GitHub job. The release
    // workflow submits the signed DMG and finishes after Apple accepts it.
    notarize: false,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
  },
  win: { icon: "resources/icons/icon.ico", target: ["nsis"] },
  linux: {
    icon: "resources/icons/icon.png",
    category: "Development",
    executableName: early ? "codeink-early-access" : "codeink",
    target: ["AppImage", "deb"],
  },
} satisfies Configuration
