import { lstat, readFile, readdir, realpath } from "node:fs/promises"
import { isAbsolute, relative, resolve } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { t } from "../shared/i18n"
import type { FileEntry } from "../shared/types"

export async function projectPath(root: string, name: string) {
  const base = await realpath(root)
  const path = await realpath(resolve(base, name))
  const remainder = relative(base, path)
  if (remainder === ".." || remainder.startsWith("../") || remainder.startsWith("..\\") || isAbsolute(remainder))
    throw new Error(t("outsideProject"))
  return path
}
export async function listFiles(root: string, name: string): Promise<FileEntry[]> {
  const path = await projectPath(root, name)
  const files = await readdir(path, { withFileTypes: true })
  return files
    .filter((file) => ![".git", "node_modules", ".DS_Store"].includes(file.name) && !file.isSymbolicLink())
    .map((file) => ({ name: file.name, path: relative(root, resolve(path, file.name)), directory: file.isDirectory() }))
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
}
export async function previewFile(root: string, name: string) {
  const path = await projectPath(root, name)
  const stats = await lstat(path)
  if (!stats.isFile()) throw new Error(t("unsupportedFile"))
  if (stats.size > 2 * 1024 * 1024) throw new Error(t("fileTooLarge"))
  const data = await readFile(path)
  if (data.includes(0)) throw new Error(t("binaryFile"))
  return data.toString("utf8")
}
export async function projectDiff(root: string) {
  const git = (args: string[]) =>
    promisify(execFile)("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: 10_000,
      windowsHide: true,
    })
  await git(["rev-parse", "--git-dir"]).catch(() => {
    throw new Error(t("notGit"))
  })
  const head = await git(["rev-parse", "--verify", "HEAD"]).then(
    () => true,
    () => false,
  )
  const diff = await git(["diff", "--no-ext-diff", "--no-textconv", ...(head ? ["HEAD"] : []), "--"])
  const staged = head ? "" : (await git(["diff", "--cached", "--no-ext-diff", "--no-textconv", "--"])).stdout
  const untracked = await git(["ls-files", "--others", "--exclude-standard"])
  return [diff.stdout, staged, untracked.stdout ? `Untracked files:\n${untracked.stdout}` : ""]
    .filter(Boolean)
    .join("\n")
}
