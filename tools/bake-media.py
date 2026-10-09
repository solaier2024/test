"""Bake development canvas captures into silent H.264 clips and first-frame posters.
Requires imageio-ffmpeg; normal npm builds use committed assets, not this script.
"""
import argparse
import json
from pathlib import Path
import subprocess
import imageio_ffmpeg

parser = argparse.ArgumentParser()
parser.add_argument('capture', type=Path)
parser.add_argument('--name', choices=['intro', 'celebration'], required=True)
parser.add_argument('--orientation', choices=['landscape', 'portrait'], required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
media = root / 'public' / 'assets' / 'media'
media.mkdir(parents=True, exist_ok=True)
stem = f'{args.name}-{args.orientation}'
clip, poster = media / f'{stem}.mp4', media / f'{stem}.webp'
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
def run(command):
    result = subprocess.run([ffmpeg, '-y', *command], capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.decode('utf-8', errors='replace')[-2000:])
run(['-ss', '0.7', '-i', str(args.capture), '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '24', '-movflags', '+faststart', str(clip)])
run(['-i', str(clip), '-frames:v', '1', '-c:v', 'libwebp', '-quality', '83', str(poster)])
reader = imageio_ffmpeg.read_frames(str(clip))
metadata = next(reader)
reader.close()
manifest_file = root / 'public' / 'assets' / 'media-manifest.json'
manifest = json.loads(manifest_file.read_text(encoding='utf-8'))
manifest['cinematics'].setdefault(args.name, {})[args.orientation] = {
    'src': f'media/{clip.name}', 'poster': f'media/{poster.name}',
    'duration': metadata['duration'], 'width': metadata['size'][0], 'height': metadata['size'][1],
    'fps': metadata['fps'], 'codec': 'H.264', 'audio': False,
}
manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'clip': clip.name, 'bytes': clip.stat().st_size, 'metadata': manifest['cinematics'][args.name][args.orientation]}))
