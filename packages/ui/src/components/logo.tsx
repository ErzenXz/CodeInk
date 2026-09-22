import { type ComponentProps } from "solid-js"
import { useI18n } from "../context/i18n"
import codeinkIcon from "../assets/brand/codeink-icon.png"

export const Mark = (props: { class?: string }) => {
  const i18n = useI18n()
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 100 100"
      role="img"
      aria-label={i18n.t("ui.brand.name")}
    >
      <image href={codeinkIcon} width="100" height="100" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  const i18n = useI18n()
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 100 100"
      role="img"
      aria-label={i18n.t("ui.brand.name")}
    >
      <image href={codeinkIcon} width="100" height="100" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  const i18n = useI18n()
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 720 129"
      classList={{ [props.class ?? ""]: !!props.class }}
      role="img"
      aria-label={i18n.t("ui.brand.name")}
    >
      <image href={codeinkIcon} x="0" y="0" width="129" height="129" />
      <text
        x="151"
        y="105"
        fill="currentColor"
        font-family="Inter, sans-serif"
        font-size="120"
        font-weight="700"
        letter-spacing="-6"
        textLength="561"
        lengthAdjust="spacingAndGlyphs"
      >
        {i18n.t("ui.brand.name")}
      </text>
    </svg>
  )
}
