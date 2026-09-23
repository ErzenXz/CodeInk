import type { AssistantMessage, Message } from "@codeink/sdk/v2/client"

type Provider = {
  id: string
  name?: string
  models: Record<string, Model | undefined>
}

type Model = {
  name?: string
  limit: {
    context: number
  }
}

type Context = {
  message: AssistantMessage
  provider?: Provider
  model?: Model
  providerLabel: string
  modelLabel: string
  limit: number | undefined
  input: number | undefined
  total: number | undefined
  output: number | undefined
  reasoning: number | undefined
  cacheRead: number | undefined
  cacheWrite: number | undefined
  usage: number | null
}

const tokenTotal = (msg: AssistantMessage) => {
  return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write
}

const lastAssistantWithTokens = (messages: Message[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    if (tokenTotal(msg) <= 0) continue
    return msg
  }
}

const build = (messages: Message[] = [], providers: Provider[] = []): Context | undefined => {
  const latest = messages.findLast((message): message is AssistantMessage => message.role === "assistant")
  const message = latest && "codeinkUsage" in latest ? latest : (lastAssistantWithTokens(messages) ?? latest)
  if (!message) return undefined

  const provider = providers.find((item) => item.id === message.providerID)
  const model = provider?.models[message.modelID]
  const reported = (
    message as AssistantMessage & {
      codeinkUsage?: {
        input?: number
        output?: number
        reasoning?: number
        cacheRead?: number
        cacheWrite?: number
        total?: number
        contextUsed?: number
        contextLimit?: number
      }
    }
  ).codeinkUsage
  const limit = reported?.contextLimit || model?.limit.context || undefined
  const total = reported ? (reported.total ?? reported.contextUsed) : tokenTotal(message)
  const used = reported?.contextUsed ?? total

  return {
    message,
    provider,
    model,
    providerLabel: provider?.name ?? message.providerID,
    modelLabel: model?.name ?? message.modelID,
    limit,
    input: reported ? reported.input : message.tokens.input,
    output: reported ? reported.output : message.tokens.output,
    reasoning: reported ? reported.reasoning : message.tokens.reasoning,
    cacheRead: reported ? reported.cacheRead : message.tokens.cache.read,
    cacheWrite: reported ? reported.cacheWrite : message.tokens.cache.write,
    total,
    usage: limit && used !== undefined ? Math.round((used / limit) * 100) : null,
  }
}

export function getSessionContext(messages: Message[] = [], providers: Provider[] = []) {
  return build(messages, providers)
}

export function getSessionCost(session: { cost?: number } | undefined) {
  if (!session || (session as { codeinkCostKnown?: boolean }).codeinkCostKnown === false) return undefined
  return session.cost
}
