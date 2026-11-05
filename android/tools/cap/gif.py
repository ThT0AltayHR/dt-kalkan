#!/usr/bin/env python3
"""Builds a phone-framed GIF from a capture.js frame folder (not shipped).
usage: gif.py <frames_dir> <out.gif> [fps=10] [start_ms=0] [end_ms=inf] [hold_ms=1200]
Frames are resampled on their capture timestamps to a steady fps, framed by compose.py,
then encoded with ffmpeg palettegen/paletteuse.
"""
import json, os, subprocess, sys, tempfile, shutil
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compose import compose

src, out = sys.argv[1], sys.argv[2]
fps = float(sys.argv[3]) if len(sys.argv) > 3 else 10
t0 = float(sys.argv[4]) if len(sys.argv) > 4 else 0
t1 = float(sys.argv[5]) if len(sys.argv) > 5 else 1e12
hold = float(sys.argv[6]) if len(sys.argv) > 6 else 1200
idx = json.load(open(os.path.join(src, 'index.json')))
idx = [f for f in idx if t0 <= f['ts'] <= t1]
step = 1000.0 / fps
start, end = idx[0]['ts'], idx[-1]['ts']
seq, t, j = [], start, 0
while t <= end + 1:
    while j + 1 < len(idx) and idx[j + 1]['ts'] <= t:
        j += 1
    seq.append(idx[j]['f'])
    t += step
seq += [seq[-1]] * int(hold / step)
tmp = tempfile.mkdtemp()
cache = {}
for i, f in enumerate(seq):
    if f not in cache:
        p = os.path.join(tmp, 'c_' + f)
        compose(Image.open(os.path.join(src, f)), solid=True).convert('RGB').save(p)
        cache[f] = p
    os.symlink(cache[f], os.path.join(tmp, '%05d.png' % i))
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
vf = 'split[a][b];[a]palettegen=max_colors=200:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle'
r = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-framerate', str(fps), '-i', os.path.join(tmp, '%05d.png'), '-vf', vf, '-loop', '0', out], capture_output=True, text=True)
shutil.rmtree(tmp)
if r.returncode:
    print(r.stderr); sys.exit(1)
print(out, len(seq), 'frames', os.path.getsize(out) // 1024, 'KB')
