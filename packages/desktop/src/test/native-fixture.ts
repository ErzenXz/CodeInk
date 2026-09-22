import { createRequire } from "node:module"
import { spawn } from "node:child_process"
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { defaults } from "../main/agents"

const directory = await realpath(await mkdtemp(join(tmpdir(), "codeink-native-")))
const project = join(directory, "workspace")
const data = join(directory, "data")
await mkdir(project)
await mkdir(data)
await writeFile(join(project, "README.md"), "# Native desktop test\nThis is a disposable local workspace.\n")
await writeFile(
  join(data, "agents.json"),
  JSON.stringify({
    agents: defaults.map((agent) => ({
      ...agent,
      command: process.execPath,
      args: [join(import.meta.dirname, "fixtures/agent.ts"), agent.protocol],
    })),
    projects: [{ name: "workspace", directory: project }],
    sessions: [
      {
        id: "ses_fixture_tools",
        agentID: "codex",
        directory: project,
        title: "Tool rendering check",
        model: "fixture-model-one",
        remoteID: "native-session",
        status: "idle",
        approvals: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [
          { id: "fixture-user", role: "user", text: "List the project files", createdAt: Date.now() },
          {
            id: "fixture-tool",
            role: "tool",
            text: "README.md",
            createdAt: Date.now(),
            completedAt: Date.now(),
            tool: {
              name: "bash",
              input: { command: "ls -la", description: "List project files" },
              output: "README.md",
              status: "completed",
              title: "List project files",
            },
          },
          {
            id: "fixture-answer",
            role: "assistant",
            text: "The project contains README.md.",
            createdAt: Date.now(),
            completedAt: Date.now(),
          },
        ],
      },
    ],
    selectedAgent: "codex",
  }),
)
const env: NodeJS.ProcessEnv = { ...process.env, CODEINK_DATA_DIR: data }
delete env.ELECTRON_RUN_AS_NODE
const executable = process.env.CODEINK_TEST_EXECUTABLE
const child = spawn(
  executable || createRequire(import.meta.url)("electron"),
  executable ? [] : [resolve(import.meta.dirname, "../..")],
  {
    env,
    stdio: "inherit",
  },
)
console.log(`Disposable original-UI fixture: ${directory}`)
await new Promise<void>((resolve, reject) => {
  child.once("error", reject)
  child.once("exit", () => resolve())
})
await rm(directory, { recursive: true, force: true })
