type Asset = { name: string; sha512: string; size: number }

export function updateMetadata(version: string, channel: string, assets: Asset[], date = new Date()) {
  const prefix = channel === "early-access" ? "early-access" : "latest"
  const targets = [
    { name: `${prefix}-mac.yml`, files: assets.filter((asset) => /-mac-(arm64|x64)\.zip$/.test(asset.name)) },
    { name: `${prefix}.yml`, files: assets.filter((asset) => /-win-x64\.exe$/.test(asset.name)) },
    { name: `${prefix}-linux.yml`, files: assets.filter((asset) => /-linux-x64\.AppImage$/.test(asset.name)) },
    { name: `${prefix}-linux-arm64.yml`, files: assets.filter((asset) => /-linux-arm64\.AppImage$/.test(asset.name)) },
  ]
  return targets.map((target) => {
    if (!target.files.length) throw new Error(`No installers for ${target.name}`)
    return {
      name: target.name,
      content: [
        `version: ${version}`,
        "files:",
        ...target.files.flatMap((file) => [
          `  - url: ${file.name}`,
          `    sha512: ${file.sha512}`,
          `    size: ${file.size}`,
        ]),
        `path: ${target.files[0].name}`,
        `sha512: ${target.files[0].sha512}`,
        `releaseDate: ${date.toISOString()}`,
        "",
      ].join("\n"),
    }
  })
}
