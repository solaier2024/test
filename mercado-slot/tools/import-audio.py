"""Prepare the licensed street-party score and our own CG's grill ambience.

Run from the repository root with Python, numpy and imageio-ffmpeg installed.
Only audio changes; existing movie frames are copied without re-encoding.
"""

import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request

import imageio_ffmpeg
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT.parent / ".asset-work" / "mercado-audio"
MEDIA = ROOT / "public" / "media"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
SOURCE_URL = (
    "https://incompetech.com/music/royalty-free/mp3-royaltyfree/"
    "Notanico%20Merengue.mp3"
)
SOURCE_SHA = "b88a89782ddba8a2e97ed2cd759586f28cdf943688d7a1cdc5e611249c517bbf"
RATE = 32_000
SECONDS = 64


def run(args):
    subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def pcm(path, start=0, duration=None):
    args = [FFMPEG, "-v", "error", "-ss", str(start), "-i", str(path)]
    if duration is not None:
        args += ["-t", str(duration)]
    return np.frombuffer(
        subprocess.check_output([*args, "-f", "f32le", "-ac", "2", "-ar", str(RATE), "-"]),
        dtype="<f4",
    ).reshape(-1, 2).copy()


def encode(samples, destination, bitrate="112k"):
    raw = WORK / "render.f32"
    raw.write_bytes(samples.astype("<f4").tobytes())
    run([
        "-f", "f32le", "-ar", str(RATE), "-ac", "2", "-i", str(raw),
        "-c:a", "aac", "-b:a", bitrate, "-movflags", "+faststart", str(destination),
    ])


def entry(path):
    data = path.read_bytes()
    return {"file": path.name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


WORK.mkdir(parents=True, exist_ok=True)
original = WORK / "Notanico Merengue.mp3"
if not original.exists():
    original.write_bytes(urllib.request.urlopen(SOURCE_URL, timeout=45).read())
assert hashlib.sha256(original.read_bytes()).hexdigest() == SOURCE_SHA, "Review changed source audio"

# 32 bars at 120 BPM, starting on the established groove after four bars.
# The short circular crossfade removes the waveform discontinuity at the join.
score = pcm(original, start=8.305, duration=SECONDS)
assert abs(len(score) - RATE * SECONDS) <= 2
score = np.pad(score, ((0, max(0, RATE * SECONDS - len(score))), (0, 0)), mode="edge")[:RATE * SECONDS]
join = int(RATE * 0.025)
fade = np.linspace(0, 1, join, endpoint=False)[:, None]
preroll = pcm(original, start=8.28, duration=0.025)
preroll = np.pad(preroll, ((0, max(0, join - len(preroll))), (0, 0)), mode="edge")[:join]
score[-join:] = score[-join:] * (1 - fade) + preroll * fade
score *= 0.88
encode(score, MEDIA / "street-fiesta.m4a")

# Reuse the approved CG's cooking sound, not a new external recording. Granular
# overlap masks its old musical phrase and the conspicuous 1.15-second repeat.
cg = ROOT.parent / ".asset-work" / "mercado-v2-originals" / "opening-cinematic.mp4"
if not cg.exists():
    raise FileNotFoundError("The original approved opening CG is required for the grill layer")
recording = pcm(cg, duration=1.15)
length = RATE * 12
grill = np.zeros((length, 2))
grain = int(RATE * 0.24)
hop = grain // 2
window = np.sin(np.linspace(0, np.pi, grain, endpoint=False)) ** 2
rng = np.random.default_rng(20261012)
for at in range(0, length, hop):
    offset = int(rng.integers(0, len(recording) - grain))
    segment = recording[offset:offset + grain]
    gain = rng.uniform(0.7, 1.05)
    indices = (np.arange(grain) + at) % length
    grill[indices] += segment * (window * gain)[:, None]
encode(grill, WORK / "grill-unfiltered.m4a", "80k")
run([
    "-i", str(WORK / "grill-unfiltered.m4a"),
    "-af", "highpass=f=450,lowpass=f=6500,loudnorm=I=-20:LRA=7:TP=-3",
    "-c:a", "aac", "-b:a", "80k", "-ar", str(RATE),
    "-movflags", "+faststart", str(MEDIA / "grill-ambience.m4a"),
])

# Give the unchanged opening footage the same party theme and cooking layer.
opening = MEDIA / "opening.mp4"
themed_opening = WORK / "opening-themed.mp4"
run([
    "-i", str(opening), "-i", str(MEDIA / "street-fiesta.m4a"),
    "-i", str(MEDIA / "grill-ambience.m4a"),
    "-filter_complex",
    "[1:a]atrim=0:4,asetpts=PTS-STARTPTS,volume=0.72,afade=t=in:d=0.04,afade=t=out:st=3.8:d=0.2[m];"
    "[2:a]atrim=0:4,asetpts=PTS-STARTPTS,volume=0.18[g];"
    "[m][g]amix=inputs=2:normalize=0,alimiter=limit=0.9:level=false[a]",
    "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac",
    "-b:a", "112k", "-t", "4", "-movflags", "+faststart", str(themed_opening),
])
opening.write_bytes(themed_opening.read_bytes())

manifest_path = MEDIA / "manifest.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
manifest["assets"]["opening-cinematic"].update(entry(opening))
manifest["assets"]["opening-cinematic"]["audioSource"] = "Notanico Merengue + original CG grill ambience; remixed"
manifest["audio"] = {
    **entry(MEDIA / "grill-ambience.m4a"),
    "duration": 12,
    "source": "Original approved opening-cinematic / first 1.15 seconds; filtered granular ambience",
}
manifest["music"] = {
    **entry(MEDIA / "street-fiesta.m4a"),
    "duration": SECONDS,
    "bpm": 120,
    "title": "Notanico Merengue",
    "artist": "Kevin MacLeod",
    "isrc": "USUAN1100130",
    "license": "CC BY 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
    "sourceUrl": SOURCE_URL,
    "sourceSha256": SOURCE_SHA,
    "changes": "64-second loop edit, circular crossfade and gain; cooking ambience mixed separately",
}
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"music": manifest["music"], "ambience": manifest["audio"]}, indent=2))
