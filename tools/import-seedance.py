"""Package a reviewed Seedance source as local horizontal/vertical intro assets.
The source is already generated; this script never submits paid generation.
"""
import argparse
import json
from pathlib import Path
import subprocess
import imageio_ffmpeg

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("--history-id", required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
media = root / "public" / "assets" / "media"
media.mkdir(parents=True, exist_ok=True)
jobs_file = root / "docs" / "seedance-jobs.json"
jobs = json.loads(jobs_file.read_text(encoding="utf-8"))
job = next(item for item in jobs["jobs"] if item["historyId"] == args.history_id)
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
manifest_file = root / "public" / "assets" / "media-manifest.json"
manifest = json.loads(manifest_file.read_text(encoding="utf-8"))

def run(params):
    result = subprocess.run([ffmpeg, "-y", *params], capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.decode("utf-8", errors="replace")[-2000:])

for orientation, transform in [
    ("landscape", "scale=1280:720"),
    ("portrait", "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=720:1280"),
]:
    stem = f"seedance-intro-{orientation}"
    clip, poster = media / f"{stem}.mp4", media / f"{stem}.webp"
    run(["-i", str(args.source), "-vf", transform, "-an", "-c:v", "libx264",
         "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p", "-r", "24",
         "-movflags", "+faststart", str(clip)])
    run(["-i", str(clip), "-frames:v", "1", "-c:v", "libwebp", "-quality", "88", str(poster)])
    reader = imageio_ffmpeg.read_frames(str(clip))
    metadata = next(reader)
    reader.close()
    manifest["cinematics"]["intro"][orientation] = {
        "src": f"media/{clip.name}", "poster": f"media/{poster.name}",
        "duration": metadata["duration"], "width": metadata["size"][0],
        "height": metadata["size"][1], "fps": metadata["fps"],
        "codec": "H.264", "audio": False,
        "source": "OpenArt / Seedance 2.0", "historyId": args.history_id,
        "framing": "original wide shot" if orientation == "landscape" else "center crop from horizontal source",
    }
    print(json.dumps({"file": clip.name, "bytes": clip.stat().st_size, "metadata": manifest["cinematics"]["intro"][orientation]}))

manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
job.update(status="COMPLETED", integrated=True, outputs={
    key: manifest["cinematics"]["intro"][key] for key in ("landscape", "portrait")
})
jobs_file.write_text(json.dumps(jobs, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
