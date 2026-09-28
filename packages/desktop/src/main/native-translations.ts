import {
  DESKTOP_NATIVE_ENGLISH,
  DESKTOP_NATIVE_KEYS,
  DESKTOP_NATIVE_LOCALE_TAGS,
  formatDesktopNativeMessage,
  type DesktopNativeBundle,
  type DesktopNativeKey,
} from "@codeink/app/i18n/desktop-native"

let bundle: DesktopNativeBundle = { locale: "en", messages: { ...DESKTOP_NATIVE_ENGLISH } }
let dateTime = new Intl.DateTimeFormat(DESKTOP_NATIVE_LOCALE_TAGS.en, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
})
let number = new Intl.NumberFormat(DESKTOP_NATIVE_LOCALE_TAGS.en)

export function setNativeTranslations(next: DesktopNativeBundle) {
  if (
    next.locale === bundle.locale &&
    DESKTOP_NATIVE_KEYS.every((key) => next.messages[key] === bundle.messages[key])
  ) {
    return false
  }
  const localeChanged = next.locale !== bundle.locale
  bundle = next
  if (localeChanged) {
    dateTime = new Intl.DateTimeFormat(DESKTOP_NATIVE_LOCALE_TAGS[next.locale], {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    })
    number = new Intl.NumberFormat(DESKTOP_NATIVE_LOCALE_TAGS[next.locale])
  }
  return true
}

export function nativeT(key: DesktopNativeKey, params?: Record<string, string | number>) {
  return formatDesktopNativeMessage(bundle.messages[key], params)
}

export function nativeDateTime(time: number) {
  return dateTime.format(time)
}

export function nativeNumber(value: number) {
  return number.format(value)
}
