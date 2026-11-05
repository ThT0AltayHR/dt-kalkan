#!/usr/bin/env python3
"""Turns captured screenshots/frames into final PNGs + GIFs (notch/toast composited on a desktop wallpaper)."""
import json, os, sys, subprocess, shutil
from PIL import Image

CAP, WALL, DIST = sys.argv[1], sys.argv[2], sys.argv[3]
meta = json.load(open(os.path.join(CAP, 'meta.json')))
wall = Image.open(WALL).convert('RGBA')
SCR = os.path.join(DIST, 'screenshots'); GIF = os.path.join(DIST, 'gifs')
os.makedirs(SCR, exist_ok=True); os.makedirs(GIF, exist_ok=True)
NOTCH_CROP = (340, 0, 1260, 400)       # region of the desktop shown for notch images
TOAST_CROP = (1600 - 470, 0, 1600, 600)

def compose(img, b, kind):
    if kind == 'notch': crop = NOTCH_CROP
    elif kind == 'toast': crop = TOAST_CROP
    else: return img.convert('RGB')
    bg = wall.crop(crop).copy()
    fr = img.convert('RGBA')
    if fr.size != (b['width'], b['height']): fr = fr.resize((b['width'], b['height']))
    bg.alpha_composite(fr, (b['x'] - crop[0], b['y'] - crop[1]))
    return bg.convert('RGB')

names = {
 '01-splash': '01-acilis-animasyonu', '02-welcome': '02-hosgeldiniz', '03-permission-1-realtime': '03-izin-1-gercek-zamanli-koruma', '03-permission-2-startup': '04-izin-2-baslangicta-calis',
 '03-permission-3-notifications': '05-izin-3-bildirimler', '03-permission-4-location': '06-izin-4-konum-hava-durumu', '03-permission-5-background': '07-izin-5-arka-plan-tarama',
 '04-onboarding-done': '08-kurulum-tamam', '13-dashboard': '09-genel-bakis', '05-scan': '10-tarama-secenekleri', '06-scan-in-progress': '11-tarama-suruyor',
 '07-results-clean': '12-sonuc-temiz', '08-results-threats': '13-sonuc-tehditler', '09-results-threat-details': '14-sonuc-tehdit-ayrintilari', '10-results-actions': '15-sonuc-islemler',
 '11-quarantine': '16-karantina', '12-history': '17-gecmis',
 '14-settings-01-general': '18-ayarlar-genel', '14-settings-02-protection': '19-ayarlar-koruma', '14-settings-03-scan': '20-ayarlar-tarama', '14-settings-04-notch': '21-ayarlar-centik',
 '14-settings-05-notifications': '22-ayarlar-bildirimler', '14-settings-06-sound': '23-ayarlar-ses', '14-settings-07-appearance': '24-ayarlar-gorunum', '14-settings-08-quarantine': '25-ayarlar-karantina',
 '14-settings-09-updates': '26-ayarlar-guncellemeler', '14-settings-10-about': '27-ayarlar-hakkinda-lisans',
 '20-notch-idle': '28-centik-bosta-saat-hava', '21-notch-expanded': '29-centik-genisletilmis', '22-notch-drop-open': '30-centik-dosya-birakma', '23-notch-drop-scanning': '31-centik-tarama',
 '24-notch-drop-clean': '32-centik-sonuc-temiz', '25-notch-drop-threat': '33-centik-sonuc-tehdit', '26-notch-quarantined': '34-centik-karantinaya-alindi', '27-notch-scan-progress': '35-centik-arka-plan-tarama',
 '28-notch-threat-alert': '36-centik-tehdit-uyarisi', '30-toast-preview': '37-bildirim-ornek', '31-notifications-stack': '38-bildirimler-yigin', '40-mascot-moods': '39-mochi-ruh-halleri',
}
for k, v in meta['shots'].items():
    src = os.path.join(CAP, 'shots', k + '.png')
    if not os.path.exists(src): continue
    out = compose(Image.open(src), v['bounds'], v['kind'])
    out.save(os.path.join(SCR, names.get(k, k) + '.png'), optimize=True)
print('screenshots:', len(os.listdir(SCR)))

gifs = {'intro': ('acilis-animasyonu', 760), 'notch-hover': ('centik-hover-genisleme', 720), 'notch-drop-clean': ('centik-surukle-birak-temiz', 720),
        'notch-drop-threat': ('centik-surukle-birak-tehdit', 720), 'toast-slide': ('bildirim-kayarak-gelme', 400), 'notch-alert': ('centik-tehdit-uyarisi', 720),
        'mascot-moods': ('mochi-ruh-halleri', 760)}
for seq, (out, width) in gifs.items():
    s = meta['seqs'].get(seq)
    if not s: continue
    tmp = os.path.join('/tmp', 'gif_' + seq); shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
    fr = s['frames']; lines = []
    for i, f in enumerate(fr):
        img = Image.open(os.path.join(CAP, 'frames', seq, f['f']))
        if s['kind'] == 'main' and seq == 'intro':
            pass
        im = compose(img, f['b'], s['kind'])
        p = os.path.join(tmp, f'{i:04d}.png'); im.save(p)
        dur = ((fr[i + 1]['ts'] - f['ts']) if i + 1 < len(fr) else 1200) / 1000
        lines.append(f"file '{p}'\nduration {max(0.02, dur):.3f}")
    lines.append(f"file '{os.path.join(tmp, f'{len(fr)-1:04d}.png')}'")
    open(os.path.join(tmp, 'list.txt'), 'w').write('\n'.join(lines) + '\n')
    dst = os.path.join(GIF, out + '.gif')
    vf = f"fps=20,scale={width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle"
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', os.path.join(tmp, 'list.txt'), '-vf', vf, '-loop', '0', dst], check=True)
    print('gif', dst, os.path.getsize(dst) // 1024, 'KB', len(fr), 'frames')
