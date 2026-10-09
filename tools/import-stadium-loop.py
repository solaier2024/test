"""Package a reviewed dynamic stadium plate in forward playback only.

After reviewing spectator gestures, stationary ball, locked camera and loop seam:
python tools/import-stadium-loop.py source.mp4 --history-id JOB \
  --review-notes "near rows clap, sections stand, foreground and goal stay fixed" \
  --crowd-motion-approved --approve
Without --approve, only new media files are written; production manifest is unchanged.
"""
import argparse
import json
from pathlib import Path
import subprocess
import imageio_ffmpeg

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("--history-id", required=True)
parser.add_argument("--review-notes")
parser.add_argument("--crowd-motion-approved", action="store_true")
parser.add_argument("--approve", action="store_true")
args = parser.parse_args()
if args.approve and not (args.review_notes and args.crowd_motion_approved):
    parser.error("Approval requires visual review of moving spectators, fixed goal, stationary ball and forward loop seam")

root = Path(__file__).resolve().parents[1]
media = root / "public/assets/media"
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

def run(command):
    result = subprocess.run([ffmpeg, "-y", *command], capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors="replace")[-2200:])

wide = media / "stadium-live-idle-landscape.mp4"
tall = media / "stadium-live-idle-portrait.mp4"
if args.source.resolve() in [wide.resolve(), tall.resolve()]:
    parser.error("The source must be distinct from the packaged output")
# Preserve all frames in chronological order. Reversing claps and flag waves
# creates visibly unnatural spectator movement.
run(["-i", str(args.source), "-vf", "scale=1280:720", "-an", "-c:v", "libx264",
     "-crf", "21", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(wide)])
run(["-i", str(wide), "-filter_complex",
     "[0:v]split[a][b];[a]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,boxblur=28:3[bg];"
     "[b]crop=960:720:160:0,scale=720:540[fg];[bg][fg]overlay=0:330[v]",
     "-map", "[v]", "-an", "-c:v", "libx264", "-crf", "22", "-pix_fmt", "yuv420p",
     "-movflags", "+faststart", str(tall)])
entry = {"crowdMotion": "approved" if args.approve else "pending", "reviewNotes": args.review_notes}
for orientation, clip in [("landscape", wide), ("portrait", tall)]:
    poster = clip.with_suffix(".webp")
    run(["-i", str(clip), "-frames:v", "1", "-c:v", "libwebp", "-quality", "88", str(poster)])
    reader = imageio_ffmpeg.read_frames(str(clip))
    metadata = next(reader)
    reader.close()
    targets = {"L": [0.31, 0.36], "C": [0.503, 0.36], "R": [0.71, 0.36]}
    if orientation == "portrait":
        targets = {key: [(p[0] * 1280 - 160) / 960, (330 + p[1] * 540) / 1280] for key, p in targets.items()}
    entry[orientation] = {
        "src": f"media/{clip.name}", "poster": f"media/{poster.name}",
        "duration": metadata["duration"], "width": metadata["size"][0], "height": metadata["size"][1],
        "fps": metadata["fps"], "audio": False, "codec": "H.264", "playback": "forward-loop",
        "source": "OpenArt / Seedance 2.0", "historyId": args.history_id,
        "framing": "locked full goal with live stands" if orientation == "landscape" else "full-goal 4:3 crop over blurred vertical padding",
        "targets": targets,
    }
if args.approve:
    path = root / "public/assets/media-manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    gameplay = manifest["gameplay"]
    gameplay["idle"] = entry
    gameplay["crowdMotionRequired"] = True
    shots = gameplay["shots"]
    required = {"goal-L-R", "goal-C-R", "goal-R-L", "goal-R-C", "goal-R-R", "save-L-L", "save-C-C", "save-R-R"}
    complete = required.issubset(shots) and all(s.get("crowdMotion") == "approved" for s in shots.values())
    gameplay["shotPackStatus"] = "complete" if complete else "partial"
    manifest["loading"]["critical"] = [entry[o]["poster"] for o in ["landscape", "portrait"]]
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"approved": args.approve, "idle": entry}, ensure_ascii=False, indent=2))
