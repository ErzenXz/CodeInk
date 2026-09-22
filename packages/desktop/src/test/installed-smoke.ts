// Read-only native model discovery: no conversations or model inference.
import { discoverModels } from "../main/adapters/model-discovery"
import { defaults, detectAgents } from "../main/agents"
import { tmpdir } from "node:os"

for (const agent of await detectAgents(defaults, process.env)) {
  if (!agent.executable) {
    console.log(`${agent.name}: not installed; skipped`)
    continue
  }
  const models = await discoverModels({
    agent,
    directory: tmpdir(),
    env: process.env,
    signal: AbortSignal.timeout(20000),
  })
  if (!models.length) throw new Error(`${agent.name}: no models returned`)
  console.log(`${agent.name}: ${models.length} models discovered (no prompt sent)`)
  console.log(models.map((model) => `  ${model.id}${model.default ? " (default)" : ""}`).join("\n"))
}
