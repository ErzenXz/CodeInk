let files: Record<string, () => Promise<string>> | undefined
let loads: Record<SoundID, () => Promise<string>> | undefined

function getFiles() {
  if (files) return files
  files = import.meta.glob("../../../ui/src/assets/audio/*.wav", { import: "default" }) as Record<
    string,
    () => Promise<string>
  >
  return files
}

export const SOUND_OPTIONS = [
  { id: "glow", label: "sound.option.glow" },
  { id: "pulse", label: "sound.option.pulse" },
  { id: "drop", label: "sound.option.drop" },
  { id: "spark", label: "sound.option.spark" },
  { id: "bloom", label: "sound.option.bloom" },
  { id: "tap", label: "sound.option.tap" },
] as const

export type SoundOption = (typeof SOUND_OPTIONS)[number]
export type SoundID = SoundOption["id"]

export function normalizeSoundID(id: string | undefined): SoundID | undefined {
  if (SOUND_OPTIONS.some((option) => option.id === id)) return id as SoundID
  if (id?.startsWith("nope-")) return "drop"
  if (id?.startsWith("alert-") || id?.startsWith("bip-bop-")) return "pulse"
  if (id?.startsWith("staplebops-") || id?.startsWith("yup-")) return "glow"
  return undefined
}

function getLoads() {
  if (loads) return loads
  loads = Object.fromEntries(
    Object.entries(getFiles()).flatMap(([path, load]) => {
      const file = path.split("/").at(-1)
      if (!file) return []
      return [[file.replace(/\.wav$/, ""), load] as const]
    }),
  ) as Record<SoundID, () => Promise<string>>
  return loads
}

const cache = new Map<SoundID, Promise<string | undefined>>()

export function soundSrc(id: string | undefined) {
  const key = normalizeSoundID(id)
  if (!key) return Promise.resolve(undefined)
  const load = getLoads()[key]
  if (!load) return Promise.resolve(undefined)
  const hit = cache.get(key)
  if (hit) return hit
  const next = load().catch(() => undefined)
  cache.set(key, next)
  return next
}

export function playSound(src: string | undefined) {
  if (typeof Audio === "undefined") return
  if (!src) return
  const audio = new Audio(src)
  audio.play().catch(() => undefined)
  return () => {
    audio.pause()
    audio.currentTime = 0
  }
}

export function playSoundById(id: string | undefined) {
  return soundSrc(id).then((src) => playSound(src))
}
