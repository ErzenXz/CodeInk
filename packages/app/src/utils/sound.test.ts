import { expect, test } from "bun:test"
import { normalizeSoundID, SOUND_OPTIONS } from "./sound"

test("CodeInk sound choices replace saved legacy cues without leaving silent selections", () => {
  expect(SOUND_OPTIONS.map((option) => option.id)).toEqual(["glow", "pulse", "drop", "spark", "bloom", "tap"])
  expect(normalizeSoundID("staplebops-02")).toBe("glow")
  expect(normalizeSoundID("alert-04")).toBe("pulse")
  expect(normalizeSoundID("bip-bop-01")).toBe("pulse")
  expect(normalizeSoundID("nope-03")).toBe("drop")
  expect(normalizeSoundID("yup-01")).toBe("glow")
  expect(normalizeSoundID("spark")).toBe("spark")
  expect(normalizeSoundID("unknown")).toBeUndefined()
})
