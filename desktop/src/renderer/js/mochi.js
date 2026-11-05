/* Mochi — the DT Kalkan mascot. Canvas port of the original Mochi bot renderer
   (superellipse body, state tints, eye shapes, badges, particles, roll, box morph).
   Used with the original author's permission. */
(function (global) {
  'use strict';
  const EYE_W = 0.25, EYE_H = 0.27, EYE_SP = 0.37, EYE_P = -0.12, EXP = 2.7, VIEW_TILT = -0.30, ACC_PITCH = 0.4;
  const INK = '#1A1412';
  const TAU = Math.PI * 2;
  const now = () => performance.now() / 1000;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const Ease = {
    out: p => 1 - Math.pow(1 - p, 3),
    inOut: p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    back: p => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); },
    lin: p => p,
  };
  const rgb = (r, g, b) => [r, g, b];

  // Mood configuration (mirrors the original state table, mapped to antivirus moods)
  const MOODS = {
    idle:     { color: rgb(0.902, 0.914, 0.933), tint: 0,    eye: 'pill',   badge: null },
    happy:    { color: rgb(0.204, 0.831, 0.600), tint: 0.22, eye: 'pill',   badge: null, blush: 0.9 },
    clean:    { color: rgb(0.204, 0.831, 0.600), tint: 0.35, eye: 'happy',  badge: 'dot', blush: 0.7, onEnter: 'finish' },
    proud:    { color: rgb(0.984, 0.749, 0.141), tint: 0.40, eye: 'happy',  badge: null, blush: 0.8, outfit: 'crown', onEnter: 'proud' },
    scanning: { color: rgb(0.388, 0.396, 0.949), tint: 0.72, eye: 'pill',   badge: 'dots', scans: true },
    thinking: { color: rgb(0.545, 0.361, 0.965), tint: 0.72, eye: 'pill',   badge: 'dots', look: [0.55, 0.55] },
    worried:  { color: rgb(0.961, 0.647, 0.141), tint: 0.70, eye: 'tired',  badge: 'bang', sweat: true },
    alarmed:  { color: rgb(0.957, 0.314, 0.369), tint: 0.80, eye: 'wide',   badge: 'bang', bounces: true, onEnter: 'shake', sweat: true },
    angry:    { color: rgb(0.957, 0.200, 0.250), tint: 0.85, eye: 'angry',  badge: 'dot', onEnter: 'shake', steam: true },
    sleepy:   { color: rgb(0.580, 0.635, 0.722), tint: 0.32, eye: 'closed', badge: null, breathes: true, zz: true },
    dizzy:    { color: rgb(0.957, 0.447, 0.714), tint: 0.70, eye: 'spiral', badge: null, onEnter: 'roll2' },
    love:     { color: rgb(0.957, 0.447, 0.714), tint: 0.30, eye: 'heart',  badge: null, blush: 1, onEnter: 'hearts' },
    question: { color: rgb(0.133, 0.827, 0.933), tint: 0.75, eye: 'pill',   badge: 'question', tilt: 0.17 },
    cool:     { color: rgb(0.204, 0.831, 0.600), tint: 0.25, eye: 'pill',   badge: null, outfit: 'sunglasses' },
  };

  // ── geometry helpers (faithful port) ──
  function mochiPathPts(rx, ry, morph, R) {
    const n = 72, e = 2 / EXP, pts = [];
    const tw = R * 1.0, th = R * 0.94, tr = R * 0.42;
    for (let i = 0; i <= n; i++) {
      const a = i / n * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const px0 = rx * (ca >= 0 ? Math.pow(ca, e) : -Math.pow(-ca, e));
      const py0 = ry * (sa >= 0 ? Math.pow(sa, e) : -Math.pow(-sa, e));
      if (morph < 0.005) pts.push([px0, py0]);
      else { const q = rrPoint(ca, sa, tw, th, tr); pts.push([lerp(px0, q[0], morph), lerp(py0, q[1], morph)]); }
    }
    return pts;
  }
  function rrPoint(ca, sa, W, H, cr) {
    const eps = 1e-6, kx = ca >= 0 ? 1 : -1, ky = sa >= 0 ? 1 : -1;
    const cx = kx * (W - cr), cy = ky * (H - cr);
    const dot = ca * cx + sa * cy, disc = dot * dot - (cx * cx + cy * cy - cr * cr);
    if (disc >= 0) { const t = dot + Math.sqrt(disc); if (t > eps) { const px = ca * t, py = sa * t; if (Math.abs(px) >= W - cr - eps && Math.abs(py) >= H - cr - eps) return [px, py]; } }
    if (Math.abs(sa) > eps) { const t = (ky * H) / sa; if (t > eps) { const x = ca * t; if (Math.abs(x) <= W - cr + eps) return [x, ky * H]; } }
    if (Math.abs(ca) > eps) { const t = (kx * W) / ca; if (t > eps) { const y = sa * t; if (Math.abs(y) <= H - cr + eps) return [kx * W, y]; } }
    return [kx * W, ky * H];
  }
  function pathFrom(ctx, pts) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); }
  function rrect(ctx, x, y, w, h, r) { r = Math.max(0, Math.min(r, w / 2, h / 2)); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function heart(ctx, s) { ctx.beginPath(); ctx.moveTo(0, s * 0.38); ctx.bezierCurveTo(-s * 1.05, -s * 0.15, -s * 0.5, -s * 0.95, 0, -s * 0.38); ctx.bezierCurveTo(s * 0.5, -s * 0.95, s * 1.05, -s * 0.15, 0, s * 0.38); ctx.closePath(); }
  function star(ctx, ro, ri) { ctx.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? ri : ro, a = -Math.PI / 2 + i * Math.PI / 5; i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); }
  function eyeFrames(R, yaw, pitch) {
    const rx = R * 1.14, ry = R * 0.88, out = [];
    for (const sd of [-1, 1]) {
      const ey = sd * EYE_SP + yaw, ep = EYE_P + pitch, cp = Math.cos(ep);
      out.push({ sd, x: Math.sin(ey) * cp * rx, y: -Math.sin(ep) * ry, fx: Math.max(0.18, Math.cos(ey)), fy: Math.max(0.18, cp), visible: Math.cos(ey) * cp > 0.04 });
    }
    return out;
  }
  // 3D surface helpers for the crown
  const ringR = y => Math.pow(1 - Math.pow(Math.min(1, Math.abs(y)), EXP), 1 / EXP);
  function rot3(p, yaw, pitch) { let [x, y, z] = p; const cy = Math.cos(yaw), sy = Math.sin(yaw); const x1 = x * cy + z * sy, z1 = -x * sy + z * cy; const cp = Math.cos(pitch), sp = Math.sin(pitch); return [x1, y * cp + z1 * sp, -y * sp + z1 * cp]; }
  function proj(H, p) { const r = rot3(p, H.yaw, VIEW_TILT + H.pitch * ACC_PITCH); return { x: r[0] * H.rx, y: -r[1] * H.ry, z: r[2] }; }
  function surf(y, lon, s = 1) { const r = ringR(y) * s; return [r * Math.sin(lon), y, r * Math.cos(lon)]; }

  class Mochi {
    constructor(canvas, opts = {}) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d');
      this.opts = opts;
      this.t0 = now();
      Object.assign(this, { yaw: 0, pitch: 0, roll: 0, tilt: 0, open: 1, sx: 1, sy: 1, oy: 0, ox: 0, tint: 0, morph: 0, blush: 0, es: 1, badgeS: 0, outfitP: 0,
        tgYaw: 0, tgPitch: 0, tgTilt: 0, tgSx: 1, tgSy: 1, tgEs: 1, slotH: 0, slotHTarget: 0, slotHVel: 0, lookX: 0, lookY: 0 });
      this.col = MOODS.idle.color.slice(); this.colT = this.col.slice();
      this.tweens = {}; this.particles = []; this.badge = null; this.eyeOverride = null; this.eyeOverrideUntil = 0;
      this.mood = 'idle'; this.cfg = MOODS.idle; this.outfit = null;
      this.nextBlink = now() + 2 + Math.random() * 3;
      this.onSound = opts.onSound || null;
      this.resize();
      if (opts.mood) this.setMood(opts.mood, true);
      if (!opts.still) this._loop();
    }
    resize() {
      const dpr = this.opts.dpr || window.devicePixelRatio || 1;
      const w = this.canvas.clientWidth || this.opts.size || 120, h = this.canvas.clientHeight || this.opts.size || 120;
      this.W = w; this.H = h;
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
      this.dpr = dpr;
    }
    destroy() { this.dead = true; cancelAnimationFrame(this.raf); }
    _loop() {
      let last = now();
      const step = () => {
        if (this.dead) return;
        const t = now(), dt = Math.min(0.05, t - last); last = t;
        if (!document.hidden && !this.paused && this.canvas.isConnected !== false) { this.update(dt); this.render(); }
        this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    }
    anim(key, keys, done) { this.tweens[key] = { keys, i: 0, from: this[key], start: now() * 1000, done }; }
    setMood(mood, instant) {
      const cfg = MOODS[mood] || MOODS.idle;
      const prev = this.mood;
      this.mood = mood; this.cfg = cfg;
      this.colT = cfg.color.slice();
      if (instant) { this.col = cfg.color.slice(); this.tint = cfg.tint; this.blush = cfg.blush || 0; }
      this.tgTilt = cfg.tilt || 0;
      this._setBadge(cfg.badge, instant);
      this.outfit = cfg.outfit || null;
      if (instant) this.outfitP = this.outfit ? 1 : 0;
      if (prev === mood && !instant) return;
      switch (cfg.onEnter) {
        case 'finish': this.doRoll(950, 1); setTimeout(() => this.emit('spark', 5), 500); break;
        case 'proud': this.anim('oy', [{ t: -0.22, d: 180, e: Ease.out }, { t: 0, d: 380, e: Ease.back }]); setTimeout(() => this.emit('star', 5), 200); break;
        case 'shake': this.anim('ox', [{ t: 0.08, d: 50, e: Ease.out }, { t: -0.08, d: 70, e: Ease.inOut }, { t: 0.06, d: 70, e: Ease.inOut }, { t: -0.05, d: 70, e: Ease.inOut }, { t: 0, d: 90, e: Ease.out }]); break;
        case 'roll2': this.doRoll(1300, 2); break;
        case 'hearts': this.emit('heart', 4); break;
        default: if (!instant) this.blink();
      }
      if (cfg.sweat) this.emit('sweat', 1);
    }
    _setBadge(b, instant) {
      if (b === this.badge) return;
      if (instant) { this.badge = b; this.badgeS = b ? 1 : 0; return; }
      this.anim('badgeS', [{ t: 0, d: 90, e: Ease.inOut }], () => { this.badge = b; if (b) this.anim('badgeS', [{ t: 1, d: 280, e: Ease.back }]); });
    }
    blink() { this.anim('open', [{ t: 0.05, d: 70, e: Ease.inOut }, { t: 1, d: 110, e: Ease.out }]); }
    doRoll(ms, turns) { this.roll = 0; this.anim('roll', [{ t: -TAU * turns, d: ms, e: Ease.inOut }], () => { this.roll = 0; }); }
    pop() { this.anim('sy', [{ t: 0.86, d: 80, e: Ease.out }, { t: 1.08, d: 140, e: Ease.out }, { t: 1, d: 260, e: Ease.back }]); this.anim('sx', [{ t: 1.12, d: 80, e: Ease.out }, { t: 0.95, d: 140, e: Ease.out }, { t: 1, d: 260, e: Ease.back }]); }
    jump() { this.anim('oy', [{ t: -0.25, d: 160, e: Ease.out }, { t: 0, d: 360, e: Ease.back }]); }
    look(x, y) { this.lookX = clamp(x, -1, 1); this.lookY = clamp(y, -1, 1); }
    setMorph(v, ms = 380) { this.anim('morph', [{ t: v, d: ms, e: Ease.inOut }]); }
    setSlot(h) { this.slotHTarget = h; }
    gulp() { this.slotHTarget = 0.5; setTimeout(() => { this.slotHTarget = 0; this.eyeOverride = 'happy'; this.eyeOverrideUntil = now() + 0.8; this.pop(); }, 180); }
    emit(type, count = 1) {
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
        const sp = 0.5 + Math.random() * 0.5;
        const p = { type, age: -i * 0.08, life: 1.1 + Math.random() * 0.5, x: Math.cos(a) * 0.7, y: Math.sin(a) * 0.55 - 0.1, vx: Math.cos(a) * sp * 0.6, vy: Math.sin(a) * sp * 0.8 - 0.2, size: 0.13 + Math.random() * 0.08, rot: Math.random() * TAU };
        if (type === 'sweat') { p.x = 0.95; p.y = -0.55; p.vx = 0.15; p.vy = 0.5; p.size = 0.11; p.life = 1.2; }
        if (type === 'z') { p.x = 0.75; p.y = -0.85; p.vx = 0.25; p.vy = -0.45; p.size = 0.13; p.life = 2.2; }
        if (type === 'steam') { p.x = (Math.random() < 0.5 ? -1 : 1) * 0.75; p.y = -0.9; p.vx = p.x * 0.25; p.vy = -0.5; p.size = 0.12; p.life = 0.9; }
        this.particles.push(p);
      }
    }
    update(dt) {
      const t = now();
      for (const key of Object.keys(this.tweens)) {
        const tw = this.tweens[key], k = tw.keys[tw.i];
        const p = clamp((t * 1000 - tw.start) / k.d, 0, 1);
        this[key] = tw.from + (k.t - tw.from) * k.e(p);
        if (p >= 1) { tw.from = k.t; tw.i++; tw.start = t * 1000; if (tw.i >= tw.keys.length) { delete this.tweens[key]; tw.done && tw.done(); } }
      }
      const cfg = this.cfg, lt = t - this.t0;
      let ty = this.lookX * 0.62, tp = this.lookY * 0.5;
      if (cfg.look) { ty = ty * 0.35 + cfg.look[0] * 0.55; tp = tp * 0.3 + cfg.look[1] * 0.5; }
      if (cfg.scans) { ty = Math.sin(lt * 2.6) * 0.6; tp = -0.06; }
      if (this.mood === 'sleepy') { ty = 0; tp = -0.14; }
      if (this.mood === 'dizzy') ty = Math.sin(lt * 9) * 0.25;
      if (this.mood === 'alarmed') { ty += Math.sin(lt * 31) * 0.03; }
      this.tgYaw = ty; this.tgPitch = tp;
      const k = 1 - Math.pow(0.0008, dt), k2 = 1 - Math.pow(0.002, dt);
      if (!this.tweens.oy) { const b = cfg.bounces ? -Math.abs(Math.sin(lt * 5.2)) * 0.07 : 0; this.oy += (b - this.oy) * k; }
      if (cfg.breathes) { this.tgSy = 1 + Math.sin(lt * 1.8) * 0.035; this.tgSx = 1 - Math.sin(lt * 1.8) * 0.02; }
      else { this.tgSy = 1 + Math.sin(lt * 2.2) * 0.012; this.tgSx = 1 - Math.sin(lt * 2.2) * 0.007; }
      if (!this.tweens.sy) this.sy += (this.tgSy - this.sy) * k2;
      if (!this.tweens.sx) this.sx += (this.tgSx - this.sx) * k2;
      this.yaw += (this.tgYaw - this.yaw) * (1 - Math.pow(0.004, dt));
      this.pitch += (this.tgPitch - this.pitch) * (1 - Math.pow(0.004, dt));
      this.tilt += (this.tgTilt - this.tilt) * (1 - Math.pow(0.01, dt));
      for (let i = 0; i < 3; i++) this.col[i] += (this.colT[i] - this.col[i]) * (1 - Math.pow(0.003, dt));
      if (!this.tweens.tint) this.tint += (cfg.tint - this.tint) * (1 - Math.pow(0.003, dt));
      this.blush += ((cfg.blush || 0) - this.blush) * (1 - Math.pow(0.01, dt));
      this.outfitP += ((this.outfit ? 1 : 0) - this.outfitP) * (1 - Math.pow(0.0005, dt));
      this.es += (this.tgEs - this.es) * k2;
      // slot spring
      const f = 260 * (this.slotHTarget - this.slotH) - 22 * this.slotHVel;
      this.slotHVel += f * dt; this.slotH = Math.max(0, this.slotH + this.slotHVel * dt);
      // blink
      if (t > this.nextBlink && !this.tweens.open && ['pill', 'wide'].includes(cfg.eye)) { this.blink(); this.nextBlink = t + 2.5 + Math.random() * 3.5; }
      if (this.eyeOverride && t > this.eyeOverrideUntil) this.eyeOverride = null;
      // ambient particles
      if (cfg.zz && (!this._nz || t > this._nz)) { this.emit('z', 1); this._nz = t + 1.4; }
      if (cfg.sweat && (!this._ns || t > this._ns)) { this.emit('sweat', 1); this._ns = t + (this.mood === 'alarmed' ? 0.9 : 1.8); }
      if (cfg.steam && (!this._nst || t > this._nst)) { this.emit('steam', 2); this._nst = t + 0.7; }
      for (const p of this.particles) p.age += dt;
      this.particles = this.particles.filter(p => p.age < p.life);
    }
    render() {
      const c = this.ctx, d = this.dpr;
      c.setTransform(d, 0, 0, d, 0, 0);
      c.clearRect(0, 0, this.W, this.H);
      const W = this.W, H = this.H;
      const R = Math.min(W, H) * 0.3, rx = R * 1.14, ry = R * 0.88;
      const cx = W / 2 + this.ox * R, cy = H / 2 + this.oy * R + R * 0.12;
      // ground shadow
      if (!this.opts.noShadow) {
        c.save(); c.translate(W / 2, H / 2 + R * 1.06);
        const g = c.createRadialGradient(0, 0, 0, 0, 0, R * 0.95);
        g.addColorStop(0, `rgba(0,0,0,${0.32 - Math.min(0.2, Math.abs(this.oy))})`); g.addColorStop(1, 'rgba(0,0,0,0)');
        c.scale(1, 0.22); c.fillStyle = g; c.beginPath(); c.arc(0, 0, R * 0.95, 0, TAU); c.fill(); c.restore();
      }
      c.save();
      c.translate(cx, cy + R * 0.88); c.scale(this.sx, this.sy); c.translate(0, -R * 0.88);
      if (this.tilt) c.rotate(this.tilt);
      this._drawOutfitBehind(c, R, rx, ry);
      const pts = mochiPathPts(rx, ry, this.morph, R);
      // body
      pathFrom(c, pts);
      let g = c.createLinearGradient(rx * 0.7, -ry * 0.85, -rx * 0.8, ry * 0.9);
      g.addColorStop(0, '#EDEDEF'); g.addColorStop(1, '#C4C5CA');
      c.fillStyle = g; c.fill();
      const et = this.tint * (1 - this.morph);
      if (et > 0.01) {
        const [r, gg, b] = this.col.map(v => Math.round(v * 255));
        g = c.createLinearGradient(0, ry, 0, -ry);
        g.addColorStop(0, `rgba(${r},${gg},${b},${0.72 * et})`); g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
        c.fillStyle = g; c.fill();
      }
      g = c.createRadialGradient(0, 0, R * 0.15, 0, 0, R * 1.25);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.6, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.2)');
      c.fillStyle = g; c.fill();
      g = c.createRadialGradient(rx * 0.34, -ry * 0.46, 0, rx * 0.34, -ry * 0.46, R * 0.42);
      g.addColorStop(0, `rgba(255,255,255,${0.55 * (1 - this.morph * 0.8)})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fill();
      // clip to body for face
      c.save(); pathFrom(c, pts); c.clip();
      const bl = Math.max(this.blush, this.tint * 0.5) * (1 - this.morph);
      if (bl > 0.01) {
        const yo = Math.sin(this.yaw) * rx * 0.8;
        c.fillStyle = `rgba(255,120,150,${0.5 * bl})`;
        for (const sd of [-1, 1]) { c.beginPath(); c.ellipse(sd * rx * 0.55 + yo, ry * 0.2, R * 0.17, R * 0.1, 0, 0, TAU); c.fill(); }
      }
      this._drawEyes(c, R, rx, ry);
      if (this.morph > 0.05) this._drawSlot(c, R);
      c.restore();
      this._drawOutfitFront(c, R, rx, ry, pts);
      c.restore();
      if (this.badge && this.badgeS > 0.01) this._drawBadge(c, R, cx - R * 0.72 * this.sx, cy - R * 0.72 * this.sy);
      this._drawParticles(c, R, cx, cy);
    }
    _drawSlot(c, R) {
      const m = this.morph, hW = R * 1.8 * m, hH = this.slotH * R * m, boxTop = -R * (0.88 + 0.06 * m), hY = boxTop + R * 0.08 * m;
      c.strokeStyle = `rgba(255,255,255,${0.55 * m})`; c.lineWidth = 1; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-R * 0.9 * m, boxTop + 1); c.lineTo(R * 0.9 * m, boxTop + 1); c.stroke();
      if (hH > 0.8) {
        const g = c.createLinearGradient(0, hY, 0, hY + hH); g.addColorStop(0, '#07080A'); g.addColorStop(1, '#10131A');
        rrect(c, -hW / 2, hY, hW, hH, Math.min(hW / 2, hH / 2)); c.fillStyle = g; c.fill();
        if (hH > 4) { c.strokeStyle = `rgba(255,255,255,${0.28 * m})`; c.beginPath(); c.moveTo(-hW / 2 + hH / 2, hY + hH - 0.5); c.lineTo(hW / 2 - hH / 2, hY + hH - 0.5); c.stroke(); }
      }
    }
    _drawEyes(c, R, rx, ry) {
      let shape = this.eyeOverride || this.cfg.eye;
      if (this.morph > 0.5) shape = this.slotHTarget > 0.05 || this.slotH > 0.1 ? 'cup' : shape;
      const frames = eyeFrames(R, this.yaw, this.pitch);
      for (const f of frames) {
        let ep = EYE_P + this.pitch + this.roll;
        ep = ((ep + Math.PI) % TAU + TAU) % TAU - Math.PI;
        const cp = Math.cos(ep), eyeYaw = f.sd * EYE_SP + this.yaw;
        if (Math.cos(eyeYaw) * cp <= 0.04) continue;
        const x = Math.sin(eyeYaw) * cp * rx, y = -Math.sin(ep) * ry + (this.morph > 0 ? ry * 0.14 * this.morph : 0);
        const fx = lerp(Math.max(0.18, Math.cos(eyeYaw)), 1, this.morph * 0.7), fy = lerp(Math.max(0.18, cp), 1, this.morph * 0.7);
        const mini = this.opts.mini ? 1.25 : 1;
        const w = R * EYE_W * this.es * mini, h = R * EYE_H * this.es * mini;
        c.save(); c.translate(x, y); c.scale(fx, fy);
        this._eye(c, shape, w, h, f.sd, R);
        c.restore();
      }
    }
    _eye(c, shape, w, h, sd, R) {
      const ink = INK;
      c.fillStyle = ink; c.strokeStyle = ink; c.lineCap = 'round';
      const open = this.open;
      switch (shape) {
        case 'wide': return this._eye(c, 'pill', w * 1.16, h * 1.12, sd, R);
        case 'pill': { const hh = Math.max(h * open, w * 0.3); rrect(c, -w / 2, -hh / 2, w, hh, Math.min(w / 2, hh / 2)); c.fill(); return; }
        case 'dot': c.beginPath(); c.arc(0, 0, w * 0.45, 0, TAU); c.fill(); return;
        case 'flat': rrect(c, -w * 0.72, -w * 0.2, w * 1.44, w * 0.4, w * 0.2); c.fill(); return;
        case 'angry': c.rotate(-sd * 0.32); rrect(c, -w * 0.7, -w * 0.22, w * 1.4, w * 0.48, w * 0.22); c.fill(); return;
        case 'happy': c.lineWidth = w * 0.5; c.beginPath(); c.arc(0, h * 0.18, w * 0.82, Math.PI + 0.21, -0.21); c.stroke(); return;
        case 'closed': c.lineWidth = w * 0.36; c.beginPath(); c.arc(0, -h * 0.08, w * 0.78, 0.26, Math.PI - 0.26); c.stroke(); return;
        case 'tired': rrect(c, -w / 2, -h * 0.02, w, h * 0.38, w / 2); c.fill(); rrect(c, -w * 0.62, -h * 0.1, w * 1.24, w * 0.22, w * 0.11); c.fill(); return;
        case 'spiral': { c.lineWidth = w * 0.22; c.beginPath(); const tt = now(); for (let a = 0; a < 4.4 * Math.PI; a += 0.2) { const r = w * 0.06 + a * w * 0.058, aa = a + tt * 9 * sd; a ? c.lineTo(Math.cos(aa) * r, Math.sin(aa) * r) : c.moveTo(Math.cos(aa) * r, Math.sin(aa) * r); } c.stroke(); return; }
        case 'heart': c.fillStyle = '#FF4D6D'; heart(c, w * 1.2); c.fill(); return;
        case 'star': c.rotate(now() * 1.5 * sd); c.fillStyle = '#F7B32B'; star(c, w * 1.05, w * 0.46); c.fill(); return;
        case 'cup': { const hh = Math.max(h * open, w * 0.3), cr = Math.min(w / 2, hh / 2); c.beginPath(); c.moveTo(-w / 2, -hh / 2); c.lineTo(w / 2, -hh / 2); c.lineTo(w / 2, hh / 2 - cr); c.quadraticCurveTo(w / 2, hh / 2, w / 2 - cr, hh / 2); c.lineTo(-w / 2 + cr, hh / 2); c.quadraticCurveTo(-w / 2, hh / 2, -w / 2, hh / 2 - cr); c.closePath(); c.fill(); return; }
      }
    }
    _drawBadge(c, R, bx, by) {
      const col = `rgb(${this.col.map(v => Math.round(v * 255)).join(',')})`;
      c.save(); c.translate(bx, by); c.scale(this.badgeS, this.badgeS);
      const t = now();
      if (this.badge === 'dots') {
        const pw = R * 0.72, ph = R * 0.36; rrect(c, -pw / 2, -ph / 2, pw, ph, ph / 2); c.fillStyle = col; c.fill();
        c.fillStyle = '#fff';
        for (let i = 0; i < 3; i++) { const ph2 = ((t * 2.4 - i * 0.22) % 1 + 1) % 1; const r = R * 0.055 * (1 + 0.4 * Math.max(0, Math.sin(ph2 * TAU))); c.beginPath(); c.arc((i - 1) * R * 0.18, 0, r, 0, TAU); c.fill(); }
      } else if (this.badge === 'bang' || this.badge === 'question') {
        c.fillStyle = '#000'; c.beginPath(); c.arc(0, 0, R * 0.3, 0, TAU); c.fill();
        c.fillStyle = col; c.beginPath(); c.arc(0, 0, R * 0.23, 0, TAU); c.fill();
        c.fillStyle = '#fff'; c.font = `900 ${R * 0.34}px Outfit, system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(this.badge === 'bang' ? '!' : '?', 0, R * 0.02);
      } else if (this.badge === 'dot') {
        c.fillStyle = '#000'; c.beginPath(); c.arc(0, 0, R * 0.2, 0, TAU); c.fill();
        c.fillStyle = col; c.beginPath(); c.arc(0, 0, R * 0.135, 0, TAU); c.fill();
      }
      c.restore();
    }
    _drawParticles(c, R, cx, cy) {
      for (const p of this.particles) {
        if (p.age <= 0) continue;
        const k = p.age / p.life, a = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
        const px = cx + (p.x + p.vx * p.age) * R * 1.3, py = cy + (p.y + p.vy * p.age) * R * 1.3, sz = R * p.size * (1 + k * 0.4);
        c.save(); c.translate(px, py); c.globalAlpha = clamp(a, 0, 1);
        switch (p.type) {
          case 'heart': c.rotate(Math.sin(p.age * 6) * 0.3); c.fillStyle = '#FF4D6D'; heart(c, sz); c.fill(); break;
          case 'star': c.rotate(p.rot + p.age * 2); c.fillStyle = '#F7B32B'; star(c, sz, sz * 0.45); c.fill(); break;
          case 'spark': c.rotate(p.rot); c.fillStyle = '#fff'; star(c, sz * 0.8, sz * 0.18); c.fill(); break;
          case 'sweat': c.fillStyle = '#7CC7FF'; c.beginPath(); c.moveTo(0, -sz); c.quadraticCurveTo(sz * 0.8, sz * 0.2, 0, sz * 0.6); c.quadraticCurveTo(-sz * 0.8, sz * 0.2, 0, -sz); c.fill(); break;
          case 'z': c.fillStyle = '#D1DBEB'; c.font = `700 ${sz * 1.9}px Outfit, system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('z', 0, 0); break;
          case 'steam': c.fillStyle = 'rgba(255,255,255,0.75)'; c.beginPath(); c.arc(0, 0, sz * 0.6, 0, TAU); c.arc(sz * 0.5, -sz * 0.3, sz * 0.45, 0, TAU); c.fill(); break;
        }
        c.restore();
      }
    }
    _crownPart(c, H, side) {
      const s = 1.06, yb = 0.46, yt = 0.66, n = 8, spikeH = 0.42, N = 120, seg = [];
      for (let i = 0; i <= N; i++) {
        const lon = -Math.PI + i / N * TAU, b = proj(H, surf(yb, lon, s));
        const ph = ((lon + Math.PI) / TAU) * n, f = ph - Math.floor(ph), spike = Math.pow(Math.max(0, 1 - Math.abs(f - 0.5) * 2), 1.6);
        const sp = surf(yt, lon, s), tt = proj(H, [sp[0] * (1 - 0.08 * spike), yt + spikeH * spike, sp[2] * (1 - 0.08 * spike)]);
        seg.push({ b, tt, z: b.z });
      }
      const keep = seg.filter(q => (side > 0 ? q.z >= 0 : q.z < 0.02)).sort((a, b) => a.b.x - b.b.x);
      if (keep.length < 2) return;
      c.beginPath(); c.moveTo(keep[0].tt.x, keep[0].tt.y);
      for (let i = 1; i < keep.length; i++) c.lineTo(keep[i].tt.x, keep[i].tt.y);
      for (let i = keep.length - 1; i >= 0; i--) c.lineTo(keep[i].b.x, keep[i].b.y);
      c.closePath();
      const g = c.createLinearGradient(0, -H.ry * 1.05, 0, -H.ry * 0.45);
      if (side < 0) { g.addColorStop(0, '#C98A12'); g.addColorStop(1, '#8A5A06'); }
      else { g.addColorStop(0, '#FFE58A'); g.addColorStop(0.5, '#FBBF24'); g.addColorStop(1, '#D08A0B'); }
      c.fillStyle = g; c.fill();
      if (side > 0) {
        const gems = ['#EF4444', '#3B82F6', '#22C55E', '#A855F7'];
        for (let k = 0; k < n; k++) {
          const lon = -Math.PI + (k + 0.5) / n * TAU, mid = proj(H, surf((yb + yt) / 2, lon, s * 1.01));
          if (mid.z <= 0.12) continue;
          const gr = H.R * 0.075; c.fillStyle = gems[k % 4];
          c.beginPath(); c.ellipse(mid.x, mid.y, gr * Math.max(0.35, mid.z), gr, 0, 0, TAU); c.fill();
          c.fillStyle = 'rgba(255,255,255,0.75)'; c.beginPath(); c.arc(mid.x - gr * 0.25 * mid.z, mid.y - gr * 0.35, gr * 0.28, 0, TAU); c.fill();
        }
      }
    }
    _drawOutfitBehind(c, R, rx, ry) {
      if (this.outfit === 'crown' && this.outfitP > 0.02) {
        c.save(); c.globalAlpha = this.outfitP; c.translate(0, -(1 - this.outfitP) * R * 0.6);
        this._crownPart(c, { R, rx, ry, yaw: this.yaw, pitch: this.pitch }, -1); c.restore();
      }
    }
    _drawOutfitFront(c, R, rx, ry, pts) {
      if (this.outfitP < 0.02 || !this.outfit) return;
      c.save(); c.globalAlpha = this.outfitP;
      if (this.outfit === 'crown') { c.translate(0, -(1 - this.outfitP) * R * 0.6); this._crownPart(c, { R, rx, ry, yaw: this.yaw, pitch: this.pitch }, 1); }
      else if (this.outfit === 'sunglasses') {
        pathFrom(c, pts); c.clip();
        const eyes = eyeFrames(R, this.yaw, this.pitch), w = R * 0.62, h = R * 0.46;
        const [le, re] = eyes;
        c.strokeStyle = '#111317'; c.lineCap = 'round';
        if (le.visible && re.visible) { c.lineWidth = R * 0.07; c.beginPath(); c.moveTo(le.x + w / 2 * le.fx * 0.9, le.y - h * 0.18); c.quadraticCurveTo((le.x + re.x) / 2, (le.y + re.y) / 2 - h * 0.42, re.x - w / 2 * re.fx * 0.9, re.y - h * 0.18); c.stroke(); }
        for (const e of eyes) { if (!e.visible) continue; c.lineWidth = R * 0.06; c.beginPath(); c.moveTo(e.x + e.sd * w / 2 * e.fx, e.y - h * 0.2); c.lineTo(e.sd * rx * 1.05, e.y - h * 0.35); c.stroke(); }
        for (const e of eyes) {
          if (!e.visible) continue;
          c.save(); c.translate(e.x, e.y); c.scale(e.fx, e.fy);
          rrect(c, -w / 2, -h / 2, w, h, h * 0.42); c.fillStyle = 'rgba(17,19,23,0.88)'; c.fill(); c.lineWidth = R * 0.05; c.strokeStyle = '#0B0C0F'; c.stroke();
          c.strokeStyle = 'rgba(255,255,255,0.45)'; c.lineWidth = R * 0.05; c.beginPath(); c.moveTo(-w * 0.28, -h * 0.05); c.lineTo(-w * 0.05, -h * 0.3); c.stroke();
          c.restore();
        }
      }
      c.restore();
    }
  }

  /** Renders a static mascot into a data URL (for toasts, tray, icons). */
  Mochi.still = function (mood, size = 96, opts = {}) {
    const cv = document.createElement('canvas');
    cv.style.width = size + 'px'; cv.style.height = size + 'px';
    const m = new Mochi(cv, Object.assign({ still: true, size, dpr: opts.dpr || 2, mood }, opts));
    m.W = size; m.H = size; m.canvas.width = size * m.dpr; m.canvas.height = size * m.dpr;
    m.particles = [];
    m.render();
    return cv.toDataURL('image/png');
  };
  Mochi.MOODS = MOODS;
  global.Mochi = Mochi;
})(typeof window !== 'undefined' ? window : globalThis);
