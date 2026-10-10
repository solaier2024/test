"""Package one reviewed action video. Never auto-approve generated results.

Example after viewing the source and its representative frames:
python tools/import-shot-clip.py source.mp4 --key save-L-L --history-id JOB \
  --kick-at 2.1 --impact-at 3.0 --review-notes "visible glove contact and moving fans" \
  --crowd-motion-approved --approve
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
    "goal-L-R", "goal-C-R", "goal-R-L", "goal-R-C", "goal-R-R",
    "save-L-L", "save-C-C", "save-R-R",
    "chip-goal-C-R", "chip-save-C-C",
])
parser.add_argument("--history-id", required=True)
parser.add_argument("--kick-at", type=float, required=True)
parser.add_argument("--impact-at", type=float, required=True)
parser.add_argument("--end-at", type=float, help="Cut a reviewed source before later generation defects")
parser.add_argument("--review-notes")
parser.add_argument("--approve", action="store_true")
parser.add_argument("--crowd-motion-approved", action="store_true")
parser.add_argument("--chip-trajectory-approved", action="store_true", help="Reviewed upward then downward lob flight; never rename a straight shot")
args = parser.parse_args()
is_chip = args.key.startswith("chip-")
if is_chip and args.approve and not args.chip_trajectory_approved:
    parser.error("Chip approval requires visually reviewed upward and downward lob flight")
if args.approve and not args.review_notes:
    parser.error("Approval requires notes from visual inspection")
if args.approve and not args.crowd_motion_approved:
    parser.error("Approval requires visible spectator motion and outcome reactions")

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
trim = ["-t", str(args.end_at)] if args.end_at is not None else []
if args.end_at is not None and args.end_at <= args.impact_at:
    parser.error("A trimmed clip must retain the actual impact")
run(["-i", str(args.source), *trim, "-vf", "scale=1280:720", "-an", "-c:v", "libx264",
     "-crf", "21", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(wide)])
run(["-i", str(wide), "-filter_complex",
     "[0:v]split[a][b];[a]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,boxblur=28:3[bg];"
     "[b]crop=960:720:160:0,scale=720:540[fg];[bg][fg]overlay=0:330[v]",
     "-map", "[v]", "-an", "-c:v", "libx264", "-crf", "22", "-pix_fmt", "yuv420p",
     "-movflags", "+faststart", str(tall)])
result, ball, keeper = args.key.split("-")[-3:]
entry = {"status": "approved", "crowdMotion": "approved" if args.crowd_motion_approved else "pending", "reviewNotes": args.review_notes}
if is_chip:
    entry["chipTrajectory"] = "approved" if args.chip_trajectory_approved else "pending"
if args.end_at is not None:
    entry["sourceRange"] = {"start": 0, "end": args.end_at}
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
        "shotType": "chip" if is_chip else "standard",
        "kickAt": args.kick_at, "impactAt": args.impact_at,
        "framing": "original wide shot" if orientation == "landscape" else "full-goal 4:3 crop over blurred vertical padding",
    }
if args.approve:
    path = root / "public/assets/media-manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    shots = manifest["gameplay"]["shots"]
    shots[args.key] = entry
    required = {"goal-L-R", "goal-C-R", "goal-R-L", "goal-R-C", "goal-R-R", "save-L-L", "save-C-C", "save-R-R"}
    complete = (required.issubset(shots) and all(s.get("crowdMotion") == "approved" for s in shots.values())
                and manifest["gameplay"]["idle"].get("crowdMotion") == "approved")
    manifest["gameplay"]["shotPackStatus"] = "complete" if complete else "partial"
    manifest["gameplay"]["chipPackStatus"] = "complete" if all(
        shots.get(key, {}).get("chipTrajectory") == "approved" for key in ["chip-goal-C-R", "chip-save-C-C"]
    ) else "missing"
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"approved": args.approve, "clip": entry}, ensure_ascii=False, indent=2))
