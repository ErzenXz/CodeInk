import { MemoryRouter, Route, createMemoryHistory, useParams } from "@solidjs/router"
import { createMemo, Show } from "solid-js"
import { useGlobal } from "@/context/global"
import { ServerConnection } from "@/context/server"
import { ServerSDKProvider } from "@/context/server-sdk"
import { ServerSyncProvider } from "@/context/server-sync"
import { TargetSessionRouteContent } from "@/pages/session"
import { requireServerKey, sessionHref } from "@/utils/session-route"

export function SessionPane(props: { server: ServerConnection.Key; sessionId: string }) {
  const history = createMemoryHistory()
  history.set({ value: sessionHref(props.server, props.sessionId), replace: true, scroll: false })
  return (
    <MemoryRouter history={history} explicitLinks>
      <Route path="/server/:serverKey/session/:id" component={PaneSessionRoute} />
    </MemoryRouter>
  )
}

function PaneSessionRoute() {
  const params = useParams<{ serverKey: string }>()
  const global = useGlobal()
  const connection = createMemo(() => {
    const key = requireServerKey(params.serverKey)
    return global.servers.list().find((item) => ServerConnection.key(item) === key)
  })

  return (
    <Show when={requireServerKey(params.serverKey)} keyed>
      <ServerSDKProvider server={connection}>
        <ServerSyncProvider server={connection}>
          <TargetSessionRouteContent />
        </ServerSyncProvider>
      </ServerSDKProvider>
    </Show>
  )
}
