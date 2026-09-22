import { DialogConnectProvider, useProviderConnectController } from "./dialog-connect-provider"
import { LocalAgents } from "./local-agents"
export function DialogCustomProvider(props: { onBack: () => void }) {
  const controller = useProviderConnectController({ onBack: props.onBack })
  controller.select("_custom")
  return <DialogConnectProvider controller={controller} />
}
export function CustomProviderForm(_props: { autofocus?: boolean } = {}) {
  return <LocalAgents selected="_custom" onSelect={() => {}} />
}
