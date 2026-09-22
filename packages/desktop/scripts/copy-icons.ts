import { cp, mkdir, rm } from "node:fs/promises"
await rm("resources/icons", { recursive: true, force: true })
await mkdir("resources/icons", { recursive: true })
await cp("icons/codeink", "resources/icons", { recursive: true })
