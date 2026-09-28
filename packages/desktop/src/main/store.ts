import Store from "electron-store"
import electron from "electron"
import { rmSync } from "node:fs"
import { join } from "node:path"

import { SETTINGS_STORE } from "./store-keys"
import { deleteStoreFileIfEmpty } from "./store-cleanup"

const cache = new Map<string, Store>()

// We cannot instantiate the electron-store at module load time because
// module import hoisting can run before the selected CodeInk userData path is set.
// Constructing a store then would write its file outside the selected profile.
export function getStore(name = SETTINGS_STORE) {
  const cached = cache.get(name)
  if (cached) return cached
  const next = new Store({
    name,
    cwd: electron.app.getPath("userData"),
    fileExtension: "",
    accessPropertiesByDotNotation: false,
  })
  cache.set(name, next)
  return next
}

export async function removeStoreFileIfEmpty(name: string) {
  if (await deleteStoreFileIfEmpty(electron.app.getPath("userData"), name)) cache.delete(name)
}

export function removeStoreFile(name: string) {
  rmSync(join(electron.app.getPath("userData"), name), { force: true })
  cache.delete(name)
}
