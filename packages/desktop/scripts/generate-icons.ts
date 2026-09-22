// Format the generated master for desktop packaging. Requires macOS sips/iconutil.
import { execFileSync } from "node:child_process"
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"

const master = resolve(import.meta.dirname, "../../ui/src/assets/brand/codeink-icon.png")
const desktop = resolve(import.meta.dirname, "../icons/codeink")
const favicon = resolve(import.meta.dirname, "../../ui/src/assets/favicon")
const temp = await mkdtemp(join(tmpdir(), "codeink-icons-"))
await mkdir(desktop, { recursive: true })
const sizes = [16, 32, 48, 64, 96, 128, 180, 192, 256, 512, 1024]
try {
  for (const size of sizes) {
    execFileSync("sips", ["-z", String(size), String(size), master, "--out", join(temp, `${size}.png`)], {
      stdio: "ignore",
    })
  }
  const iconset = join(temp, "CodeInk.iconset")
  await mkdir(iconset)
  for (const size of [16, 32, 128, 256, 512]) {
    await copyFile(join(temp, `${size}.png`), join(iconset, `icon_${size}x${size}.png`))
    await copyFile(join(temp, `${size * 2}.png`), join(iconset, `icon_${size}x${size}@2x.png`))
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(desktop, "icon.icns")])
  await copyFile(join(temp, "1024.png"), join(desktop, "icon.png"))
  await copyFile(join(temp, "1024.png"), join(desktop, "dock.png"))
  for (const size of [32, 64, 128, 256, 512])
    await copyFile(join(temp, `${size}.png`), join(desktop, `${size}x${size}.png`))

  const images = await Promise.all(
    [16, 32, 48, 256].map(async (size) => ({ size, png: await readFile(join(temp, `${size}.png`)) })),
  )
  const header = Buffer.alloc(6 + images.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16
    header[entry] = size === 256 ? 0 : size
    header[entry + 1] = size === 256 ? 0 : size
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  const ico = Buffer.concat([header, ...images.map((image) => image.png)])
  await writeFile(join(desktop, "icon.ico"), ico)
  for (const name of ["favicon.ico", "favicon-v3.ico"]) await writeFile(join(favicon, name), ico)
  for (const name of ["favicon-96x96.png", "favicon-96x96-v3.png"])
    await copyFile(join(temp, "96.png"), join(favicon, name))
  for (const name of ["apple-touch-icon.png", "apple-touch-icon-v3.png"])
    await copyFile(join(temp, "180.png"), join(favicon, name))
  for (const size of [192, 512])
    await copyFile(join(temp, `${size}.png`), join(favicon, `web-app-manifest-${size}x${size}.png`))
  const png = (await readFile(join(temp, "256.png"))).toString("base64")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><image width="256" height="256" href="data:image/png;base64,${png}" /></svg>\n`
  for (const name of ["favicon.svg", "favicon-v3.svg"]) await writeFile(join(favicon, name), svg)
} finally {
  await rm(temp, { recursive: true, force: true })
}
console.log("CodeInk desktop icons and favicons generated from the master.")
