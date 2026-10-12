"""Import approved original Seedance footage for the game's resource package.

Normal npm builds use committed assets. Requires imageio-ffmpeg and Pillow.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import urllib.request
from urllib.parse import urlparse
import imageio_ffmpeg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT.parent / '.asset-work' / 'mercado-v2-originals'
OUT = ROOT / 'public' / 'media'
ART = ROOT / 'public' / 'art'
for folder in (RAW, OUT):
    folder.mkdir(parents=True, exist_ok=True)
journal = json.loads((ROOT / 'docs' / 'video-generation-journal.json').read_text(encoding='utf-8'))
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

def run(args):
    proc = subprocess.run([ffmpeg, '-hide_banner', '-y', *map(str, args)], capture_output=True)
    if proc.returncode:
        raise RuntimeError(proc.stderr.decode(errors='replace')[-4000:])
    return proc.stderr.decode(errors='replace')

manifest = {'version': 1, 'reviewed': False, 'generator': 'OpenArt Seedance 2.0', 'assets': {}}
files = {}
for job in journal['jobs']:
    if job['status'] != 'COMPLETED':
        raise RuntimeError('Incomplete approved job')
    resource = next(r for r in job['resources'] if r['mediaType'] == 'video')
    url = resource['url']
    if urlparse(url).scheme != 'https' or urlparse(url).hostname != 'cdn.openart.ai':
        raise RuntimeError('Unexpected media origin')
    name = job['name']
    source = RAW / (name + '.mp4')
    if not source.exists():
        req = urllib.request.Request(url, headers={'User-Agent': 'Mercado-Asset-Import/1.0'})
        with urllib.request.urlopen(req, timeout=120) as response:
            source.write_bytes(response.read())
    filenames = {'landscape-environment': 'market-landscape.mp4', 'portrait-environment': 'market-portrait.mp4', 'opening-cinematic': 'opening.mp4'}
    filename = filenames[name]
    target = OUT / filename
    if name != 'opening-cinematic':
        # Forward-only end/start dissolve. The ending returns to the same
        # half-second source point as the beginning without reversing people.
        graph = '[0:v]split=2[a][b];[a]trim=start=0.5:end=6,setpts=PTS-STARTPTS,fps=24,settb=1/24[tail];[b]trim=start=0:end=0.5,setpts=PTS-STARTPTS,fps=24,settb=1/24[head];[tail][head]xfade=transition=fade:duration=0.5:offset=5[v]'
        run(['-i', source, '-filter_complex', graph, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '25', '-maxrate', '1400k', '-bufsize', '2800k', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target])
    else:
        run(['-i', source, '-t', '4', '-vf', 'fps=24', '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-maxrate', '2200k', '-bufsize', '4400k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '112k', '-af', 'alimiter=limit=0.9', '-movflags', '+faststart', target])
    reader = imageio_ffmpeg.read_frames(str(target)); metadata = next(reader); reader.close()
    content = target.read_bytes()
    if len(content) > 2_000_000:
        raise RuntimeError('Clip exceeds budget')
    files[name] = target
    manifest['assets'][name] = {'file': filename, 'historyId': job['historyId'], 'bytes': len(content),
        'sha256': hashlib.sha256(content).hexdigest(), 'width': metadata['size'][0], 'height': metadata['size'][1],
        'fps': metadata['fps'], 'duration': metadata['duration'], 'hasAudio': name == 'opening-cinematic'}

# This game's own cooking sound is an optional ambience layer, not a library song.
run(['-i', files['opening-cinematic'], '-t', '1.15', '-vn', '-af', 'afade=t=in:d=0.07,afade=t=out:st=1.03:d=0.12,highpass=f=500,lowpass=f=8000', '-c:a', 'aac', '-b:a', '80k', OUT / 'grill-ambience.m4a'])
audio = (OUT / 'grill-ambience.m4a').read_bytes()
manifest['audio'] = {'file': 'grill-ambience.m4a', 'bytes': len(audio), 'sha256': hashlib.sha256(audio).hexdigest(), 'source': 'opening-cinematic / first 1.15 seconds'}
art_manifest = json.loads((ART / 'manifest.json').read_text(encoding='utf-8'))
for mode, name in [('landscape', 'landscape-environment'), ('portrait', 'portrait-environment')]:
    raw = run(['-ss', '0.7', '-i', files[name], '-frames:v', '1', RAW / (mode + '-poster.png')])
    filename = 'market-' + mode + '-v2.webp'
    image = Image.open(RAW / (mode + '-poster.png'))
    image.save(ART / filename, 'WEBP', quality=75)
    data = (ART / filename).read_bytes()
    art_manifest['assets'] = [a for a in art_manifest['assets'] if a['file'] != filename]
    art_manifest['assets'].append({'file': filename, 'width': image.width, 'height': image.height, 'alpha': False,
        'critical': True, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
for asset in art_manifest['assets']:
    if asset['file'] == 'market.webp':
        asset['critical'] = False
(ART / 'manifest.json').write_text(json.dumps(art_manifest, indent=2) + '\n', encoding='utf-8')
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(json.dumps(manifest, indent=2))
