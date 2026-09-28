"""Generate CodeInk's original notification sounds with the Python standard library."""

from math import exp, pi, sin
from pathlib import Path
from struct import pack
from wave import open as wave_open


RATE = 44_100
DESTINATION = Path(__file__).resolve().parents[1] / "src/assets/audio"

# Frequency, onset, duration, and level. Short overlapping notes keep every cue soft.
SOUNDS = {
    "glow": [(523.25, 0.00, 0.26, 0.58), (783.99, 0.085, 0.34, 0.42)],
    "pulse": [(587.33, 0.00, 0.17, 0.48), (698.46, 0.15, 0.22, 0.38)],
    "drop": [(493.88, 0.00, 0.15, 0.47), (369.99, 0.105, 0.29, 0.46)],
    "spark": [(880.00, 0.00, 0.20, 0.41), (1174.66, 0.065, 0.26, 0.25)],
    "bloom": [(440.00, 0.00, 0.28, 0.44), (554.37, 0.075, 0.33, 0.35), (659.25, 0.15, 0.29, 0.24)],
    "tap": [(659.25, 0.00, 0.14, 0.45)],
}


def sample(frequency: float, elapsed: float, duration: float) -> float:
    if elapsed < 0 or elapsed >= duration:
        return 0.0
    attack = min(1.0, elapsed / 0.008)
    release = min(1.0, (duration - elapsed) / 0.045)
    envelope = attack * release * exp(-3.2 * elapsed / duration)
    phase = 2 * pi * frequency * elapsed
    return envelope * (sin(phase) + 0.14 * sin(2 * phase) + 0.035 * sin(3 * phase))


def generate() -> None:
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for name, notes in SOUNDS.items():
        length = max(onset + duration for _, onset, duration, _ in notes) + 0.025
        frames = bytearray()
        for index in range(round(length * RATE)):
            time = index / RATE
            value = sum(level * sample(frequency, time - onset, duration) for frequency, onset, duration, level in notes)
            fade = min(1.0, (length - time) / 0.025)
            frames.extend(pack("<h", round(max(-1.0, min(1.0, value * fade * 0.45)) * 32767)))
        with wave_open(str(DESTINATION / f"{name}.wav"), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(RATE)
            output.writeframes(frames)


if __name__ == "__main__":
    generate()
