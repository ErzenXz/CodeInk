import { createUniqueId, type ComponentProps } from "solid-js"
import { Logo } from "../../components/logo"

export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  const gradient = createUniqueId()
  const mask = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 720 129"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g opacity="0.16" mask={`url(#${mask})`}>
        <Logo />
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="720" height="129">
          <rect width="720" height="129" fill={`url(#${gradient})`} />
        </mask>
        <linearGradient id={gradient} x1="360" y1="68" x2="360" y2="129" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
