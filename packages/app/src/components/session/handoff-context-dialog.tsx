import { ButtonV2 } from "@codeink/ui/v2/button-v2"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@codeink/ui/v2/dialog-v2"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"

export function HandoffContextDialog(props: { prompt: string }) {
  const language = useLanguage()
  const copy = () =>
    navigator.clipboard.writeText(props.prompt).then(
      () => showToast({ title: language.t("session.handoff.copied") }),
      (error: unknown) =>
        showToast({
          variant: "error",
          title: language.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
    )

  return (
    <Dialog size="large" class="max-h-[min(80vh,720px)]">
      <DialogHeader>
        <DialogTitle>{language.t("session.handoff.view")}</DialogTitle>
      </DialogHeader>
      <DialogBody class="flex min-h-0 flex-col gap-4 p-4">
        <p class="text-[13px] leading-5 text-v2-text-text-muted">{language.t("session.handoff.description")}</p>
        <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-v2-border-border-muted">
          <div class="border-b border-v2-border-border-muted px-3 py-2 font-mono text-[12px] text-v2-text-text-muted">
            {language.t("session.handoff.file")}
          </div>
          <pre class="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[12px] leading-5 text-v2-text-text-base select-text">
            {props.prompt}
          </pre>
        </div>
        <ButtonV2 variant="outline" size="small" class="self-end" onClick={() => void copy()}>
          {language.t("session.handoff.copy")}
        </ButtonV2>
      </DialogBody>
    </Dialog>
  )
}
