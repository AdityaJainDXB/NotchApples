#!/usr/bin/env python3
"""Makes Klick's keyboard sounds: small WAV files, synthesised (no recordings), shared by the Mac and Windows apps.

    python3 scripts/klick_sounds.py        ->  NotchWindows/src/sounds/klick/<pack>/{down1,down2,down3,up,space,enter}.wav

Each sound is built from what a real switch does: the stem hitting the bottom (a damped thump through the case and
plate), the plate and keycap ringing (a few damped resonances), a click jacket or tactile bump on the way down for
clicky and tactile switches, the spring, and a quieter sound as the key comes back up. Three slightly different key-down
sounds stop fast typing sounding like a machine gun. The space bar and Enter are bigger keys with stabilisers, so they are
deeper and longer (and the typewriter rings its bell on Enter).
"""

import os
import wave

import numpy as np

RATE = 44100
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "NotchWindows", "src", "sounds", "klick")


def t(sec):
    return np.arange(int(RATE * sec)) / RATE


def damped(freq, decay, amp=1.0, sec=0.25, phase=0.0, sweep=0.0):
    """A sine at `freq` Hz dying away with time constant `decay` seconds (optionally gliding down by `sweep` Hz)."""
    x = t(sec)
    f = freq - sweep * (1 - np.exp(-x / max(decay, 1e-4)))
    return amp * np.sin(2 * np.pi * np.cumsum(f) / RATE + phase) * np.exp(-x / decay)


def biquad(x, kind, freq, q=0.7):
    """A simple RBJ biquad filter (lowpass, highpass or bandpass)."""
    w = 2 * np.pi * freq / RATE
    a = np.sin(w) / (2 * q)
    c = np.cos(w)
    if kind == "lp":
        b0, b1, b2 = (1 - c) / 2, 1 - c, (1 - c) / 2
    elif kind == "hp":
        b0, b1, b2 = (1 + c) / 2, -(1 + c), (1 + c) / 2
    else:
        b0, b1, b2 = a, 0.0, -a
    a0, a1, a2 = 1 + a, -2 * c, 1 - a
    b0, b1, b2, a1, a2 = b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        out = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, v, y1, out
        y[i] = out
    return y


def burst(sec, decay, kind, freq, q=0.8, amp=1.0, rng=None):
    """A short filtered noise burst: the hard 'tick' of plastic on plastic."""
    rng = rng or np.random.default_rng(1)
    x = rng.uniform(-1, 1, int(RATE * sec)) * np.exp(-t(sec) / decay)
    return amp * biquad(x, kind, freq, q)


def place(total, part, at):
    """Adds `part` into `total` starting `at` seconds in."""
    i = int(at * RATE)
    n = min(len(part), len(total) - i)
    if n > 0:
        total[i:i + n] += part[:n]
    return total


# Every pack: how its switch sounds. Frequencies in Hz, times in seconds.
#   body   resonances of plate/case on bottom-out: (freq, decay, amp)
#   tick   the hard contact noise: (filter, centre, q, amp)
#   click  an extra click before bottom-out (clicky / tactile): (delay, filter, centre, amp) or None
#   up     key-up level, and how bright it is
#   big    extra low resonance for the space bar and Enter (stabiliser thock)
PACKS = {
    "cream": dict(name="Cream", body=[(165, 0.045, 1.0), (390, 0.03, 0.55), (880, 0.018, 0.3)], tick=("bp", 2300, 1.2, 0.35),
                  click=None, up=(0.32, 1800), big=(110, 0.07, 0.9)),
    "holypanda": dict(name="Holy Panda", body=[(140, 0.05, 1.0), (330, 0.035, 0.5), (760, 0.02, 0.28)], tick=("bp", 1900, 1.0, 0.3),
                      click=(0.012, "bp", 1400, 0.45), up=(0.3, 1500), big=(95, 0.08, 1.0)),
    "blue": dict(name="Blue", body=[(420, 0.02, 0.6), (1100, 0.012, 0.45)], tick=("hp", 3000, 0.7, 0.55),
                 click=(0.009, "bp", 5200, 1.0), up=(0.55, 4200), big=(180, 0.05, 0.6)),
    "red": dict(name="Red", body=[(260, 0.028, 0.8), (640, 0.018, 0.45), (1500, 0.01, 0.25)], tick=("bp", 3000, 1.0, 0.3),
                click=None, up=(0.25, 2600), big=(150, 0.05, 0.7)),
    "brown": dict(name="Brown", body=[(230, 0.03, 0.85), (560, 0.02, 0.45), (1300, 0.012, 0.25)], tick=("bp", 2600, 1.0, 0.3),
                  click=(0.011, "bp", 2000, 0.3), up=(0.28, 2200), big=(140, 0.055, 0.75)),
    "topre": dict(name="Topre", body=[(190, 0.035, 0.9), (470, 0.02, 0.4)], tick=("lp", 1500, 0.7, 0.35),
                  click=None, up=(0.22, 1200), big=(120, 0.06, 0.85)),
    "typewriter": dict(name="Typewriter", body=[(600, 0.03, 0.7), (1700, 0.05, 0.45), (2900, 0.06, 0.3), (4300, 0.04, 0.2)],
                       tick=("hp", 2500, 0.6, 0.9), click=(0.006, "bp", 3500, 0.7), up=(0.35, 3000), big=(250, 0.08, 0.7)),
    "bubble": dict(name="Bubble", body=[], tick=("bp", 3000, 2.0, 0.1), click=None, up=(0.3, 2000), big=None, bubble=True),
}


def key_down(p, variant, big=False):
    rng = np.random.default_rng(variant * 31 + (7 if big else 0))
    pitch = 1 + (variant - 2) * 0.035 + (rng.random() - 0.5) * 0.02
    out = np.zeros(int(RATE * (0.32 if big else 0.2)))
    if p.get("bubble"):
        f0 = (520 if not big else 300) * pitch
        place(out, damped(f0, 0.03, 1.0, 0.15, sweep=-f0 * 0.6), 0)          # a rising "bloop"
        place(out, damped(f0 * 2.02, 0.015, 0.25, 0.1, sweep=-f0), 0.002)
    shift = 0.0
    if p["click"]:
        d, kind, f, a = p["click"]
        place(out, burst(0.012, 0.002, kind, f * pitch, 2.5, a, rng), 0)       # click jacket / tactile bump
        place(out, damped(f * 0.9 * pitch, 0.004, a * 0.5, 0.03), 0)
        shift = d
    kind, f, q, a = p["tick"]
    place(out, burst(0.02, 0.0025, kind, f * pitch, q, a, rng), shift)        # stem bottoming out
    for f, dec, a in p["body"]:
        place(out, damped(f * pitch, dec * (1.4 if big else 1), a, 0.25, phase=rng.random()), shift)
    if big and p["big"]:
        f, dec, a = p["big"]
        place(out, damped(f, dec, a, 0.3), shift)                              # stabiliser thock
        place(out, burst(0.05, 0.012, "bp", 900, 1.5, 0.12, rng), shift + 0.004)   # a little stabiliser rattle
    # A soft low thump through the desk, and the spring.
    place(out, burst(0.03, 0.008, "lp", 260, 0.7, 0.5, rng), shift)
    place(out, damped(5400 * pitch, 0.012, 0.03, 0.05), shift + 0.002)
    return out


def key_up(p):
    rng = np.random.default_rng(99)
    lvl, bright = p["up"]
    out = np.zeros(int(RATE * 0.1))
    if p.get("bubble"):
        place(out, damped(900, 0.015, 0.6, 0.06, sweep=-200), 0)
    place(out, burst(0.012, 0.0015, "bp", bright, 1.2, 1.0, rng), 0)
    for f, dec, a in p["body"][:2]:
        place(out, damped(f * 1.6, dec * 0.4, a * 0.5, 0.08), 0)
    return out * lvl


def bell():
    """The typewriter's end-of-line bell."""
    x = damped(2350, 0.35, 0.6, 0.9) + damped(2350 * 2.76, 0.18, 0.2, 0.9) + damped(2350 * 5.4, 0.08, 0.08, 0.9)
    return x


def save(path, x, peak):
    x = x - np.mean(x)
    x = x / (np.max(np.abs(x)) or 1) * peak
    fade = min(len(x), int(RATE * 0.01))
    x[-fade:] *= np.linspace(1, 0, fade)
    data = (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(data)


def main():
    for pid, p in PACKS.items():
        folder = os.path.join(OUT, pid)
        os.makedirs(folder, exist_ok=True)
        for v in (1, 2, 3):
            save(os.path.join(folder, f"down{v}.wav"), key_down(p, v), 0.7)
        save(os.path.join(folder, "up.wav"), key_up(p), 0.7 * p["up"][0] * 1.6)
        save(os.path.join(folder, "space.wav"), key_down(p, 2, big=True), 0.75)
        enter = key_down(p, 3, big=True)
        if pid == "typewriter":
            enter = place(np.concatenate([enter, np.zeros(int(RATE * 0.7))]), bell(), 0.03)
        save(os.path.join(folder, "enter.wav"), enter, 0.75)
        print(pid, "ok")


if __name__ == "__main__":
    main()
