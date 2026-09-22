// GitHub defines missing secrets as empty strings. electron-builder treats an
// empty CSC_LINK as the current directory, so omit absent signing credentials.
const env = { ...process.env }
for (const key of [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "WIN_CSC_LINK",
  "WIN_CSC_KEY_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
])
  if (!env[key]) delete env[key]
const child = Bun.spawn(
  [
    process.execPath,
    "x",
    "electron-builder",
    "--config",
    "electron-builder.config.ts",
    ...process.argv.slice(2),
    "--publish",
    "never",
  ],
  { cwd: "packages/desktop", env, stdout: "inherit", stderr: "inherit" },
)
process.exit(await child.exited)
