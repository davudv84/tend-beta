"""Restrained sound design for the TEND demo, synthesized (no samples, no music library).
Cue times mirror CUES in src/timeline.ts. Output: public/audio/score.wav (48 kHz stereo).
The original recording has no usable audio (a constant DC offset), so nothing from it is reused."""
import numpy as np, wave, os, sys

SR = 48000
TOTAL = 45.0
# mirrors CUES in src/timeline.ts
CUES = dict(block=1.9, approved=22.0 + (50.0 - 42.5), end=41.3)
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

def place(sig, at, gain_db):
    i = int(at * SR); j = min(n, i + len(sig)); s = sig[: j - i] * db(gain_db)
    L[i:j] += s; R[i:j] += s

def env(dur, attack, decay):
    k = np.arange(int(dur * SR)) / SR
    return np.minimum(1, k / attack) * np.exp(-k / decay)

# room tone: dark and nearly inaudible, so the cues do not land in digital silence
noise = onepole_lp(onepole_lp(rng.standard_normal(n), 160), 160)
noise /= np.abs(noise).max()
bed = np.clip(t / 1.0, 0, 1) * np.clip((TOTAL - t) / 2.0, 0, 1)
L += noise * bed * db(-40); R += np.roll(noise, 997) * bed * db(-40)

# the block: one quiet, low, damped tone. No alarm.
k = np.arange(int(0.8 * SR)) / SR
thud = np.sin(2 * np.pi * (72 + 30 * np.exp(-k / 0.03)) * k) * env(0.8, 0.004, 0.18)
place(thud, CUES["block"], -12)

# the approval: one soft confirmation, two close partials
k = np.arange(int(1.2 * SR)) / SR
conf = (np.sin(2 * np.pi * 784 * k) + 0.35 * np.sin(2 * np.pi * 1176 * k)) * env(1.2, 0.006, 0.22)
place(conf, CUES["approved"], -26)

# end: a faint low fifth under the tagline
k = np.arange(int(3.6 * SR)) / SR
chord = (np.sin(2 * np.pi * 110 * k) + 0.5 * np.sin(2 * np.pi * 165 * k)) * np.minimum(1, k / 0.9) * np.exp(-k / 1.8)
place(chord, CUES["end"], -26)

mix = np.stack([L, R], 1)
mix *= db(-5) / np.abs(mix).max()  # normalise so the block thud peaks at -5 dBFS
os.makedirs("public/audio", exist_ok=True)
with wave.open("public/audio/score.wav", "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype(np.int16).tobytes())
print("peak dBFS", 20 * np.log10(np.abs(mix).max()))
