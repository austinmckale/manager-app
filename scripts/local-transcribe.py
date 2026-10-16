"""Transcribe on this computer. No hosted speech API or cloud fallback."""
import json
import os
import sys
from pathlib import Path

packages = os.environ.get("INTAKE_PYTHON_PACKAGES")
if packages:
    sys.path.insert(0, packages)
from faster_whisper import WhisperModel

cache = Path(__file__).resolve().parent.parent / ".vercel" / "local-ai" / "models"
cache.mkdir(parents=True, exist_ok=True)
# CPU int8 avoids competing with Ollama for the RTX 3070's VRAM.
model = WhisperModel("small.en", device="cpu", compute_type="int8", download_root=str(cache))
if len(sys.argv) < 2 or sys.argv[1] == "--download-only":
    print(json.dumps({"ready": True, "model": "small.en", "device": "cpu"}))
else:
    segments, info = model.transcribe(sys.argv[1], language="en", vad_filter=True, beam_size=5, condition_on_previous_text=False)
    text = " ".join(segment.text.strip() for segment in segments if segment.no_speech_prob < 0.8).strip()
    print(json.dumps({"text": text[:6000], "language": info.language, "duration": info.duration}))
