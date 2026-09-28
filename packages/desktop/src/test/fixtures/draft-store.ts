import assert from "node:assert/strict"
import { join } from "node:path"
import { createDesktopDraftStore } from "../../main/draft-store"

const path = join(process.argv[2], "drafts.sqlite")
const store = createDesktopDraftStore(path)
const bytes = new TextEncoder().encode("attached image")
const id = store.putBlob(bytes)
const orphan = store.putBlob(new TextEncoder().encode("removed image"))
store.set("prompt", JSON.stringify({ text: "first" }))
store.set("prompt", JSON.stringify({ text: "latest", blob: { id } }))
assert.equal(JSON.parse(store.get("prompt")!).text, "latest")
store.set("removed", JSON.stringify({ text: "delete me" }))
store.flush()
store.set("removed", null)
store.close()

const restored = createDesktopDraftStore(path)
assert.deepEqual(JSON.parse(restored.get("prompt")!), { text: "latest", blob: { id } })
assert.deepEqual(new Uint8Array(restored.getBlob(id)!), bytes)
assert.equal(restored.getBlob(orphan), null)
assert.equal(restored.get("removed"), null)
restored.close()
console.log("Draft persistence and attachment recovery passed")
