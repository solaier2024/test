"""Package one reviewed action video. Never auto-approve generated results.

Example after viewing the source and its representative frames:
python tools/import-shot-clip.py source.mp4 --key save-L-L --history-id JOB \
  --kick-at 2.1 --impact-at 3.0 --review-notes "visible left glove contact" --approve
Without --approve, only MP4/poster files are written, not the production manifest.
"""
import argparse
import json
from pathlib import Path
import subprocess
import imageio_ffmpeg

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("--key", required=True, choices=[
    "goal-L-R", "goal-C-R", "goal-R-L", "goal-R-C",
    "save-L-L", "save-C-C", "save-R-R",
])
parser.add_argument("--history-id", required=True)
parser.add_argument("--kick-at", type=float, required=True)
parser.add_argument("--impact-at", type=float, required=True)
parser.add_argument("--review-notes")
parser.add_argument("--approve", action="store_true")
args = parser.parse_args()
if args.approve and not args.review_notes:
    parser.error("Approval requires notes from visual inspection")

root = Path(__file__).resolve().parents[1]
media = root / "public/assets/media"
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

def run(command):
    result = subprocess.run([ffmpeg, "-y", *command], capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors="replace")[-2200:])

wide = media / f"{args.key}-landscape.mp4"
tall = media / f"{args.key}-portrait.mp4"
if args.source.resolve() in [wide.resolve(), tall.resolve()]:
    parser.error("The source must be distinct from the packaged output")
run(["-i", str(args.source), "-vf", "scale=1280:720", "-an", "-c:v", "libx264",
     "-crf", "21", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(wide)])
run(["-i", str(wide), "-filter_complex",
     "[0:v]split[a][b];[a]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,boxblur=28:3[bg];"
     "[b]crop=960:720:160:0,scale=720:540[fg];[bg][fg]overlay=0:330[v]",
     "-map", "[v]", "-an", "-c:v", "libx264", "-crf", "22", "-pix_fmt", "yuv420p",
     "-movflags", "+faststart", str(tall)])
result, ball, keeper = args.key.split("-")
entry = {"status": "approved", "reviewNotes": args.review_notes}
for orientation, clip in [("landscape", wide), ("portrait", tall)]:
    poster = clip.with_suffix(".webp")
    run(["-i", str(clip), "-frames:v", "1", "-c:v", "libwebp", "-quality", "88", str(poster)])
    reader = imageio_ffmpeg.read_frames(str(clip))
    metadata = next(reader)
    reader.close()
    if not (0 <= args.kick_at < args.impact_at < metadata["duration"]):
        parser.error("Timing must be calibrated inside the actual output duration")
    entry[orientation] = {
        "src": f"media/{clip.name}", "poster": f"media/{poster.name}",
        "duration": metadata["duration"], "width": metadata["size"][0], "height": metadata["size"][1],
        "fps": metadata["fps"], "audio": False, "codec": "H.264",
        "source": "OpenArt / Seedance 2.0", "historyId": args.history_id,
        "ballDir": ball, "diveDir": keeper, "saved": result == "save",
        "kickAt": args.kick_at, "impactAt": args.impact_at,
        "framing": "original wide shot" if orientation == "landscape" else "full-goal 4:3 crop over blurred vertical padding",
    }
if args.approve:
    path = root / "public/assets/media-manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    shots = manifest["gameplay"]["shots"]
    shots[args.key] = entry
    manifest["gameplay"]["shotPackStatus"] = "complete" if len(shots) == 7 else "partial"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"approved": args.approve, "clip": entry}, ensure_ascii=False, indent=2))
