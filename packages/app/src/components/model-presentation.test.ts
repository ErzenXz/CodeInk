import { expect, test } from "bun:test"
import { compareModels } from "./model-presentation"

test("local models retain native ranking instead of alphabetical model names", () => {
  const provider = { id: "local-codex" }
  const models = [
    { name: "Daybreak Blue", provider, options: { codeinkOrder: 3 } },
    { name: "GPT-5.6 Luna", provider, options: { codeinkOrder: 2 } },
    { name: "GPT-6 Astra", provider, options: { codeinkOrder: 0 } },
    { name: "GPT-5.6 Sol", provider, options: { codeinkOrder: 1 } },
  ]
  expect(models.sort(compareModels).map((model) => model.name)).toEqual([
    "GPT-6 Astra",
    "GPT-5.6 Sol",
    "GPT-5.6 Luna",
    "Daybreak Blue",
  ])
})
