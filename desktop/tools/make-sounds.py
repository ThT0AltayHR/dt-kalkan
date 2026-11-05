#!/usr/bin/env python3
"""Synthesizes the DT Kalkan virus alarm + the 'Minimal' sound pack (all original)."""
import numpy as np, wave, os, sys
SR = 44100
out = sys.argv[1]
os.makedirs(os.path.join(out, 'minimal'), exist_ok=True)

def write(path, x, peak=0.85):
    x = np.asarray(x, dtype=np.float64)
    m = np.max(np.abs(x)) or 1
    x = x / m * peak
    d = (x * 32767).astype(np.int16)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(d.tobytes())

def t(d): return np.arange(int(SR * d)) / SR
def env(n, a=0.005, r=0.1, curve=4):
    e = np.ones(n); ai = int(SR * a)
    if ai: e[:ai] = np.linspace(0, 1, ai)
    tt = np.arange(n) / SR
    e *= np.exp(-tt / max(r, 1e-4) * 1.0) if curve == 'exp' else 1
    return e
def adsr(n, a, d, s, r):
    e = np.zeros(n); A = int(a * SR); D = int(d * SR); R = int(r * SR); S = max(0, n - A - D - R)
    e[:A] = np.linspace(0, 1, A, endpoint=False); e[A:A + D] = np.linspace(1, s, D, endpoint=False)
    e[A + D:A + D + S] = s; e[A + D + S:] = np.linspace(s, 0, n - (A + D + S)); return e
def tone(f, d, shape='sine', harm=(1,), amp=(1,)):
    tt = t(d); y = np.zeros_like(tt)
    for h, a in zip(harm, amp): y += a * np.sin(2 * np.pi * f * h * tt)
    return y
def bell(f, d):
    tt = t(d)
    return (np.sin(2*np.pi*f*tt) + .5*np.sin(2*np.pi*f*2.76*tt)*np.exp(-tt*6) + .25*np.sin(2*np.pi*f*5.4*tt)*np.exp(-tt*9)) * np.exp(-tt*3.2)
def mix(*parts):
    n = max(len(p[1]) + int(p[0]*SR) for p in parts); y = np.zeros(n)
    for off, s in parts: o = int(off*SR); y[o:o+len(s)] += s
    return y
def reverb(x, wet=.18):
    y = x.copy()
    for dl, g in ((0.029, .5), (0.041, .4), (0.067, .3), (0.089, .22), (0.131, .15)):
        k = int(dl*SR); z = np.zeros_like(x); z[k:] = x[:-k] * g; y += z * wet * 3
    return y

# ── distinct virus alarm (two-tone, urgent, rising, with sub pulse) ──
def alarm():
    seg = []
    for i, f in enumerate([880, 660, 880, 660, 988]):
        d = .13 if i < 4 else .26
        tt = t(d)
        y = np.sign(np.sin(2*np.pi*f*tt)) * .35 + np.sin(2*np.pi*f*tt) * .65
        y += .3 * np.sin(2*np.pi*f/2*tt)
        y *= adsr(len(tt), .004, .03, .8, .04)
        seg.append(y); seg.append(np.zeros(int(.025*SR)))
    y = np.concatenate(seg)
    lp = np.convolve(y, np.ones(6)/6, mode='same')
    return reverb(lp, .25)
write(os.path.join(out, 'alarm.wav'), alarm(), .8)

# ── Minimal pack ──
mn = os.path.join(out, 'minimal')
def pop():
    tt = t(.12); f = 520 + 900*np.exp(-tt*40)
    return np.sin(2*np.pi*np.cumsum(f)/SR) * np.exp(-tt*38)
def whoosh(up=True, d=.32):
    n = int(d*SR); noise = np.random.default_rng(3).standard_normal(n)
    # band sweep via moving average of different lengths
    out_ = np.zeros(n); tt = np.arange(n)/SR
    for k in range(0, n, 256):
        p = k/n; w = int(4 + (40 if up else 4) * (1-p) + (4 if up else 40) * p)
        seg = noise[k:k+256]; out_[k:k+256] = np.convolve(seg, np.ones(w)/w, mode='same')
    e = np.sin(np.pi * np.clip(tt/d, 0, 1)) ** 1.5
    f = (300 + 500*tt/d) if up else (800 - 500*tt/d)
    body = .25*np.sin(2*np.pi*np.cumsum(f)/SR)
    return (out_*3 + body) * e
def tick():
    tt = t(.04); return (np.sin(2*np.pi*2200*tt)*.6 + np.sin(2*np.pi*3300*tt)*.3) * np.exp(-tt*160)
def chime():
    return reverb(mix((0, bell(1046.5, 1.0)), (.09, bell(1318.5, .9)*.8), (.18, bell(1568, 1.1)*.7)), .3)
def blip():
    return mix((0, tone(1320, .09)*adsr(int(.09*SR), .003, .02, .5, .05)), (.08, tone(1760, .12)*adsr(int(.12*SR), .003, .03, .4, .07)))
def gulp():
    tt = t(.22); f = 380*np.exp(-tt*6) + 120
    return np.sin(2*np.pi*np.cumsum(f)/SR) * adsr(len(tt), .01, .05, .6, .12)
def attach():
    tt = t(.18); f = 700 + 600*tt/.18
    return np.sin(2*np.pi*np.cumsum(f)/SR) * adsr(len(tt), .005, .04, .5, .1) * .7
def send():
    tt = t(.3); f = 500 + 1400*(tt/.3)**2
    return reverb(np.sin(2*np.pi*np.cumsum(f)/SR) * adsr(len(tt), .01, .1, .5, .15), .2)
def error():
    return mix((0, tone(392, .16, harm=(1, 2, 3), amp=(1, .3, .15))*adsr(int(.16*SR), .004, .05, .6, .08)), (.17, tone(311, .26, harm=(1, 2, 3), amp=(1, .3, .15))*adsr(int(.26*SR), .004, .05, .6, .15)))
def greet():
    return reverb(mix((0, bell(784, .8)*.8), (.12, bell(1046.5, .8)*.8), (.24, bell(1318.5, 1.2))), .35)
def hover():
    tt = t(.05); return np.sin(2*np.pi*1800*tt) * np.exp(-tt*90) * .4
for name, fn in {'pop': pop, 'open': lambda: whoosh(True), 'close': lambda: whoosh(False, .26), 'tick': tick, 'finish': chime, 'blip': blip,
                 'gulp': gulp, 'attach': attach, 'send': send, 'error': error, 'greet': greet, 'hover': hover, 'peek': lambda: whoosh(True, .2),
                 'approval': error, 'proud': chime, 'search': blip, 'approve': blip, 'wink': pop}.items():
    write(os.path.join(mn, name + '.wav'), fn(), .7)
# minimal alarm: softer two-tone
tt = t(.5); a = np.where((tt*8).astype(int) % 2 == 0, np.sin(2*np.pi*740*tt), np.sin(2*np.pi*587*tt)) * adsr(len(tt), .01, .05, .8, .1)
write(os.path.join(mn, 'alarm.wav'), a, .7)
print('sounds ok')
