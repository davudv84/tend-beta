"""Synthesizes the STAND-IN voiceover from voiceover/script.json with Kokoro (open-weights TTS, Apache-2.0).
It is a synthetic voice, not the founder's. Record your own lines into voiceover/founder/<id>.wav to replace it.
Usage: <python with kokoro-onnx> scripts/make-voiceover.py <dir with kokoro-v1.0.onnx + voices-v1.0.bin>
Model files: https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0"""
import json, os, sys
import soundfile as sf
from kokoro_onnx import Kokoro

models = sys.argv[1]
here = os.path.join(os.path.dirname(__file__), "..")
script = json.load(open(os.path.join(here, "voiceover/script.json")))
k = Kokoro(os.path.join(models, "kokoro-v1.0.onnx"), os.path.join(models, "voices-v1.0.bin"))
for line in script["lines"]:
    samples, sr = k.create(line["text"], voice="af_heart", speed=1.06, lang="en-us")
    path = os.path.join(here, "voiceover/synthetic", f"{line['id']}.wav")
    sf.write(path, samples, sr)
    print(f"{line['id']}  at {line['at']:5.2f}s  len {len(samples)/sr:4.2f}s  ends {line['at']+len(samples)/sr:5.2f}s")
