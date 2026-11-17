"""Builds public/audio/score.wav: the voiceover (founder recording if present, else the synthetic stand-in) placed
at the times in voiceover/script.json, two quiet cues tied to real on-screen events, then loudness-normalised.
No music. The original recording has no usable audio, so nothing from it is reused. Needs ffmpeg + numpy."""
import json, os, subprocess, tempfile, wave
import numpy as np

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SR = 48000
TOTAL = 46.0
CUES = dict(block=3.8, approved=22.9 + (50.0 - 42.6))  # mirrors CUES in src/timeline.ts
n = int(SR * TOTAL)
mix = np.zeros(n)

def db(x): return 10 ** (x / 20)

def load(path):
    """Any audio file -> mono float at 48 kHz, via ffmpeg."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)

def place(sig, at):
    i = int(at * SR); j = min(n, i + len(sig)); mix[i:j] += sig[: j - i]

def env(dur, attack, decay):
    k = np.arange(int(dur * SR)) / SR
    return np.minimum(1, k / attack) * np.exp(-k / decay)

# voiceover
script = json.load(open(os.path.join(HERE, "voiceover/script.json")))
used = []
NO_VO = os.environ.get("NO_VO") == "1"  # cues only, for recording your own voice over the picture
for line in ([] if NO_VO else script["lines"]):
    founder = os.path.join(HERE, "voiceover/founder", f"{line['id']}.wav")
    path = founder if os.path.exists(founder) else os.path.join(HERE, "voiceover/synthetic", f"{line['id']}.wav")
    v = load(path)
    v = v / (np.sqrt(np.mean(v ** 2)) + 1e-9) * db(-20)  # every line at the same speech level
    place(v, line["at"])
    used.append(("founder" if path == founder else "synthetic", line["id"]))

# cues, well under the voice
k = np.arange(int(0.7 * SR)) / SR
place(np.sin(2 * np.pi * (72 + 30 * np.exp(-k / 0.03)) * k) * env(0.7, 0.004, 0.16) * db(-24), CUES["block"])
k = np.arange(int(1.0 * SR)) / SR
place((np.sin(2 * np.pi * 784 * k) + 0.35 * np.sin(2 * np.pi * 1176 * k)) * env(1.0, 0.006, 0.18) * db(-36), CUES["approved"])

tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
with wave.open(tmp, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((np.clip(mix / max(1, np.abs(mix).max()), -1, 1) * 32767).astype(np.int16).tobytes())
os.makedirs(os.path.join(HERE, "public/audio"), exist_ok=True)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", tmp, "-af", "volume=0dB" if NO_VO else "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", str(SR), "-ac", "2",
                os.path.join(HERE, "public/audio/score_novo.wav" if NO_VO else "public/audio/score.wav")], check=True)
os.unlink(tmp)
print("voice:", ", ".join(f"{i}={s}" for s, i in used))
