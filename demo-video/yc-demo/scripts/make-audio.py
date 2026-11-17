"""Restrained sound design for the TEND demo, synthesized (no samples, no music library).
Cue times mirror CUES in src/timeline.ts. Output: public/audio/score.wav (48 kHz stereo).
The original recording has no usable audio (a constant DC offset), so nothing from it is reused."""
import numpy as np, wave, os, sys

SR = 48000
TOTAL = 53.0
CUES = dict(block=2.2, rowReveal=8.6, approveClick=25.0 + (49.55 - 42.5), ran=25.0 + (52.5 - 42.5), end=46.4)
n = int(SR * TOTAL)
t = np.arange(n) / SR
L = np.zeros(n); R = np.zeros(n)
rng = np.random.default_rng(7)

def db(x): return 10 ** (x / 20)

def onepole_lp(x, fc):
    a = np.exp(-2 * np.pi * fc / SR); y = np.empty_like(x); acc = 0.0
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc; y[i] = acc
    return y

def place(sig, at, gain_db, pan=0.0):
    i = int(at * SR); j = min(n, i + len(sig)); s = sig[: j - i] * db(gain_db)
    L[i:j] += s * (1 - max(0, pan)); R[i:j] += s * (1 + min(0, pan))

def env(dur, attack, decay):
    k = np.arange(int(dur * SR)) / SR
    return np.minimum(1, k / attack) * np.exp(-k / decay)

# 1) room tone: dark, barely there; fades in with the picture and out after the logo
noise = onepole_lp(onepole_lp(rng.standard_normal(n), 180), 180)
noise /= np.abs(noise).max()
bed = np.clip(t / 1.2, 0, 1) * np.clip((TOTAL - t) / 2.5, 0, 1)
L += noise * bed * db(-34); R += np.roll(noise, 997) * bed * db(-34)

# 2) a low drone under the opening, released when the block lands
drone = (np.sin(2 * np.pi * 55 * t) + 0.5 * np.sin(2 * np.pi * 82.4 * t)) * np.clip(t / 1.5, 0, 1) * np.clip((CUES["block"] + 1.6 - t) / 1.6, 0, 1)
L += drone * db(-30); R += drone * db(-30)

# 3) block: a muted, low thud with a short body; no alarm
k = np.arange(int(0.9 * SR)) / SR
thud = np.sin(2 * np.pi * (70 + 40 * np.exp(-k / 0.04)) * k) * env(0.9, 0.003, 0.22)
thud += 0.25 * np.sin(2 * np.pi * 140 * k) * env(0.9, 0.002, 0.08)
place(thud, CUES["block"], -10)

# 4) small interface ticks
def tick(freq=1800, dur=0.06):
    k = np.arange(int(dur * SR)) / SR
    return np.sin(2 * np.pi * freq * k) * env(dur, 0.001, 0.012)
place(tick(1500), CUES["rowReveal"], -24, pan=-0.3)
place(tick(2100), CUES["approveClick"], -22, pan=-0.3)

# 5) the approved command runs: two soft notes, a fifth apart
def note(freq, dur=1.4):
    k = np.arange(int(dur * SR)) / SR
    return (np.sin(2 * np.pi * freq * k) + 0.12 * np.sin(2 * np.pi * 2 * freq * k)) * env(dur, 0.01, 0.35)
place(note(659.3), CUES["ran"], -24, pan=0.25)
place(note(987.8), CUES["ran"] + 0.12, -27, pan=0.25)

# 6) end: one warm, low chord under the tagline
k = np.arange(int(5.5 * SR)) / SR
chord = sum(np.sin(2 * np.pi * fq * k) * w for fq, w in [(110, 1), (164.8, 0.6), (220, 0.35), (277.2, 0.18)])
chord *= np.minimum(1, k / 0.8) * np.exp(-k / 2.4)
place(chord, CUES["end"], -22)

mix = np.stack([L, R], 1)
mix *= db(-5) / np.abs(mix).max()  # normalise so the block thud peaks at -5 dBFS
os.makedirs("public/audio", exist_ok=True)
with wave.open("public/audio/score.wav", "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype(np.int16).tobytes())
print("peak dBFS", 20 * np.log10(np.abs(mix).max()))
