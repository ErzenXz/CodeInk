import { rm } from "node:fs/promises"

export async function removeFixture(directory: string) {
  // Bun's Windows rm does not honor Node's maxRetries option. Process-tree
  // termination is asynchronous, so wait for the working-directory lock itself.
  const deadline = Date.now() + 4000
  for (;;) {
    try {
      await rm(directory, { recursive: true, force: true })
      return
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        !["EBUSY", "EPERM", "ENOTEMPTY"].includes(String(error.code)) ||
        Date.now() >= deadline
      )
        throw error
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}
