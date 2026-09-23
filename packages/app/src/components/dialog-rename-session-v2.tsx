import { ButtonV2 } from "@codeink/ui/v2/button-v2"
import { useDialog } from "@codeink/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@codeink/ui/v2/dialog-v2"
import { DividerV2 } from "@codeink/ui/v2/divider-v2"
import { TextInputV2 } from "@codeink/ui/v2/text-input-v2"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { errorMessage } from "@/pages/layout/helpers"
import { showToast } from "@/utils/toast"

export function DialogRenameSessionV2(props: { title: string; onSave: (title: string) => Promise<unknown> }) {
  const language = useLanguage()
  const dialog = useDialog()
  const [state, setState] = createStore({ title: props.title, saving: false })

  const save = () => {
    const title = state.title.trim()
    if (!title || state.saving) return
    if (title === props.title) {
      dialog.close()
      return
    }
    setState("saving", true)
    void props.onSave(title).then(
      () => dialog.close(),
      (cause: unknown) => {
        setState("saving", false)
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(cause, language.t("common.requestFailed")),
        })
      },
    )
  }

  return (
    <Dialog fit>
      <form
        class="contents"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <DialogHeader>
          <DialogTitle>{language.t("sidebar.context.session.renameTitle")}</DialogTitle>
        </DialogHeader>
        <DividerV2 />
        <DialogBody class="flex w-full min-w-0 flex-col gap-2 px-4 py-4">
          <label for="sidebar-session-name" class="text-12-medium text-v2-text-text-muted">
            {language.t("sidebar.context.session.name")}
          </label>
          <TextInputV2
            id="sidebar-session-name"
            appearance="large"
            class="!w-full"
            autofocus
            value={state.title}
            disabled={state.saving}
            onInput={(event) => setState("title", event.currentTarget.value)}
          />
        </DialogBody>
        <DialogFooter>
          <ButtonV2 variant="neutral" disabled={state.saving} onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </ButtonV2>
          <ButtonV2 type="submit" variant="contrast" disabled={!state.title.trim() || state.saving}>
            {language.t("common.save")}
          </ButtonV2>
        </DialogFooter>
      </form>
    </Dialog>
  )
}
