"""Derive a reversible anticipation loop from the reviewed Seedance opening.
No outcome footage is invented. This only packages existing project media.
"""
import json
from pathlib import Path
import subprocess
import imageio_ffmpeg

root = Path(__file__).resolve().parents[1]
media = root / "public/assets/media"
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
source = media / "seedance-intro-landscape.mp4"
manifest_file = root / "public/assets/media-manifest.json"
manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
if manifest.get("gameplay", {}).get("idle", {}).get("crowdMotion") == "approved":
    raise SystemExit("Refusing to overwrite the reviewed dynamic crowd loop with the legacy CG excerpt")

def run(args):
    result = subprocess.run([ffmpeg, "-y", *args], capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors="replace")[-2200:])

wide = media / "match-idle-landscape.mp4"
run(["-i", str(source), "-filter_complex",
     "[0:v]trim=0:0.85,setpts=PTS-STARTPTS,split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0[v]",
     "-map", "[v]", "-r", "24", "-an", "-c:v", "libx264", "-crf", "21", "-pix_fmt", "yuv420p",
     "-movflags", "+faststart", str(wide)])
# Preserve the entire goal on phones; a blurred version of the same footage
# fills the vertical margins. This is an adapted wide shot, not native 9:16.
tall = media / "match-idle-portrait.mp4"
run(["-i", str(wide), "-filter_complex",
     "[0:v]split[a][b];[a]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,boxblur=28:3[bg];"
     "[b]crop=960:720:160:0,scale=720:540[fg];[bg][fg]overlay=0:330[v]",
     "-map", "[v]", "-an", "-c:v", "libx264", "-crf", "22", "-pix_fmt", "yuv420p",
     "-movflags", "+faststart", str(tall)])
manifest["version"] = 2
manifest.setdefault("gameplay", {})
manifest["gameplay"].update({"presentation": "video", "idle": {"crowdMotion": "pending"}})
manifest["gameplay"].setdefault("shots", {})
for orientation, clip in [("landscape", wide), ("portrait", tall)]:
    poster = clip.with_suffix(".webp")
    run(["-i", str(clip), "-frames:v", "1", "-c:v", "libwebp", "-quality", "88", str(poster)])
    reader = imageio_ffmpeg.read_frames(str(clip))
    metadata = next(reader)
    reader.close()
    targets = {"L": [0.31, 0.36], "C": [0.503, 0.36], "R": [0.71, 0.36]}
    if orientation == "portrait":
        targets = {key: [(p[0] * 1280 - 160) / 960, (330 + p[1] * 540) / 1280] for key, p in targets.items()}
    manifest["gameplay"]["idle"][orientation] = {
        "src": f"media/{clip.name}", "poster": f"media/{poster.name}",
        "duration": metadata["duration"], "width": metadata["size"][0], "height": metadata["size"][1],
        "fps": metadata["fps"], "audio": False, "codec": "H.264",
        "source": "OpenArt / Seedance 2.0", "historyId": "KQ9mego53d8bOcrD0Ur8",
        "framing": "anticipation loop" if orientation == "landscape" else "full-goal 4:3 crop over blurred vertical padding",
        "targets": targets,
    }
# Do not cut back to the old cartoon celebration after a photographic match.
manifest["cinematics"].pop("celebration", None)
manifest["loading"] = {
    "critical": ["media/match-idle-landscape.webp", "media/match-idle-portrait.webp"],
    "next": ["intro"], "deferred": ["shots"],
}
manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(manifest["gameplay"]["idle"], ensure_ascii=False))
