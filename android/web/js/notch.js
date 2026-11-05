/* Dynamic notch / island — phone edition of the desktop notch (same states, animations, sounds, Mochi).
   Hosts: "overlay" (system overlay window around the camera cutout) and "inapp" (iframe inside the app). */
(function () {
  'use strict';
  const { t, $, esc, Sound, fmtAgo, fmtNum, midEllipsis } = UI;
  const I = (n, s) => Icons.icon(n, s);
  const HOST = dt.host || 'overlay';
  const PAD = 12; // window padding around the pill (overlay)
  const N = window.Notch = {
    state: 'idle', settings: null, st: null, weather: null, scan: null, dragDepth: 0, busy: false, geom: { width: 412, height: 915, top: 32 },
    W() { return this.geom.width || screen.width || 412; },
    NH() { return Math.max(34, Math.round((this.geom.cutoutH || this.geom.top || 30) + 4)); },
    pillSize(s) {
      const W = this.W(), NH = this.NH();
      const m = { idle: [Math.min(W - 160, 188), NH], progress: [Math.min(W - 160, 188), NH], hover: [Math.min(W - 16, 396), 182], drag: [Math.min(W - 24, 340), 184],
        scan: [Math.min(W - 16, 384), 184], result: [Math.min(W - 16, 384), this.resultBad ? 204 : 184], alert: [Math.min(W - 16, 384), 118] };
      return m[s] || m.idle;
    },
    async init() {
      const g = window.__dtInsetsVal || {};
      if (g.width) this.geom = Object.assign(this.geom, g);
      if (HOST === 'overlay') { try { const gg = await dt.ui('notch:geom'); if (gg && gg.width) this.geom = Object.assign(this.geom, gg); } catch { } }
      document.documentElement.classList.add('notch-' + HOST);
      dt.on('insets', (ins) => { if (ins && ins.width) { this.geom = Object.assign(this.geom, ins); this.apply(true); } });
      this.st = await dt.core('getState');
      this.applySettings(this.st.settings);
      this.m = {
        mini: new Mochi($('#miniM'), { size: 28, mood: 'idle', mini: true, noShadow: true }),
        hover: new Mochi($('#hoverM'), { size: 76, mood: 'happy', noShadow: true }),
        drop: new Mochi($('#dropM'), { size: 116, mood: 'happy', noShadow: true }),
        scan: new Mochi($('#scanM'), { size: 108, mood: 'scanning', noShadow: true }),
        alert: new Mochi($('#alertM'), { size: 80, mood: 'angry', noShadow: true }),
      };
      this.apply(true);
      this.pauseHidden();
      this.tick(); setInterval(() => this.tick(), 1000);
      this.loadWeather(); setInterval(() => this.loadWeather(), 30 * 60000);
      this.wire();
      if (this.st.scan) this.onProgress(this.st.scan);
      this.renderHover();
      setTimeout(() => { this.m.mini.setMood('happy'); this.m.mini.jump(); setTimeout(() => this.m.mini.setMood(this.idleMood()), 2200); }, 600);
    },
    applySettings(s) {
      this.settings = s;
      I18N.setLang(s.lang); UI.applyAppearance(s); Sound.set(s.sound);
      document.body.classList.toggle('island', s.notch.style === 'island');
    },
    idleMood() { const p = this.st.protection; return this.scan ? 'scanning' : p.level === 'ok' ? 'idle' : p.level === 'warn' ? 'worried' : 'alarmed'; },
    pauseHidden() {
      const vis = { idle: ['mini'], progress: ['mini'], hover: ['hover'], drag: ['drop'], scan: ['scan', 'drop'], result: ['scan'], alert: ['alert'] }[this.state] || [];
      for (const [k, m] of Object.entries(this.m)) m.paused = !vis.includes(k);
    },
    /** Applies the pill size of the current state and asks the host to fit its window around it. */
    apply(instant) {
      const pill = $('#pill');
      const [w, h] = this.pillSize(this.state);
      const top = document.body.classList.contains('island') ? 6 : 0;
      document.documentElement.style.setProperty('--W', this.W() + 'px');
      document.documentElement.style.setProperty('--nh', this.NH() + 'px');
      if (HOST === 'inapp' && this.geom.cutout && this.geom.cutout.x) document.documentElement.style.setProperty('--cxo', Math.round(this.geom.cutout.x - this.W() / 2) + 'px');
      if (instant) pill.style.transition = 'none';
      pill.style.width = w + 'px'; pill.style.height = h + 'px';
      if (instant) { void pill.offsetWidth; pill.style.transition = ''; }
      const prevWin = this._win || [0, 0];
      const win = [w + PAD * 2, h + top + PAD];
      const grow = win[0] >= prevWin[0] || win[1] >= prevWin[1];
      clearTimeout(this._shrinkT);
      if (this._full) return;
      if (grow || instant) { this._win = win; dt.ui('notch:size', { w: win[0], h: win[1], pill: [w, h] }); }
      else this._shrinkT = setTimeout(() => { this._win = win; dt.ui('notch:size', { w: win[0], h: win[1], pill: [w, h] }); }, 560);
    },
    setFull(on) {
      this._full = on;
      if (on) dt.ui('notch:size', { full: true });
      else { this._win = null; this.apply(); }
      document.body.classList.toggle('full', on);
    },
    setState(s, opts = {}) {
      const prev = this.state;
      if (prev === s && !opts.force) return;
      this.state = s;
      const pill = $('#pill');
      pill.className = 's-' + s + (opts.cls ? ' ' + opts.cls : '');
      this.apply();
      const layer = { idle: 'idle', progress: 'idle', hover: 'hover', drag: 'drop', scan: 'scanL', result: 'scanL', alert: 'alert' }[s];
      for (const id of ['idle', 'hover', 'drop', 'scanL', 'alert']) $('#' + id).classList.toggle('on', id === layer);
      this.pauseHidden();
      if ((prev === 'idle' || prev === 'progress') && s === 'hover') Sound.play('open', { gain: 0.7 });
      if (prev === 'hover' && (s === 'idle' || s === 'progress')) Sound.play('close', { gain: 0.6 });
      clearTimeout(this._autoCollapse);
      if (s === 'hover') this._autoCollapse = setTimeout(() => { if (this.state === 'hover') this.collapse(); }, 7000);
      dt.emit && dt.emit('notch:state', s);
    },
    collapse() {
      if (this.busy) return;
      this.resultBad = false;
      this.setState(this.scan && this.settings.notch.showProgress ? 'progress' : 'idle');
      this.m.mini.setMood(this.idleMood());
    },

    // ── idle content ──
    tick() {
      let pc = null; try { pc = window.parent !== window && window.parent.__dtClock; } catch { }
      const now = window.__dtClock || pc || new Date();
      const h24 = this.settings.notch.clock24;
      const locale = I18N.getLang() === 'tr' ? 'tr-TR' : 'en-US';
      const tm = now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: !h24 });
      if (tm !== this._tm) {
        this._tm = tm;
        $('#clock').textContent = tm; $('#bigClock').textContent = tm;
        $('#bigDate').textContent = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
      }
    },
    async loadWeather(force) {
      if (!this.settings.notch.weather || this.settings.permissions.location === false) { this.weather = null; this.renderWeather(); return; }
      try { this.weather = await dt.core('getWeather', !!force); } catch { this.weather = null; }
      this.renderWeather();
    },
    renderWeather() {
      const w = this.weather;
      const u = w && w.unit === 'f' ? '°F' : '°';
      $('#wx').innerHTML = w ? `${Icons.weatherIcon(w.code, w.isDay, 16)}<span>${Math.round(w.temp)}${u}</span>` : `<span style="opacity:.55">${I('shieldCheck', 15)}</span>`;
      $('#wcard').innerHTML = w
        ? `${Icons.weatherIcon(w.code, w.isDay, 30)}<div class="wt">${Math.round(w.temp)}°</div><div class="wd" style="min-width:0"><b>${esc(w.city || '')}</b><br>${t('n.feels', { t: Math.round(w.feels) + '°' })} · ↑${Math.round(w.max)}° ↓${Math.round(w.min)}°</div>`
        : `${I('location', 20)}<div class="wd">${t('n.weatherOff')}</div>`;
    },
    renderHover() {
      const st = this.st, p = st.protection, s = st.settings;
      const scanning = this.scan;
      $('#hTitle').textContent = scanning ? t('side.scanning', { p: Math.round(scanning.percent * 100) }) : p.level === 'ok' ? t('n.protected') : p.level === 'warn' ? t('side.attention') : t('side.atRisk');
      $('#hDot').style.background = p.level === 'ok' ? 'var(--ok)' : p.level === 'warn' ? 'var(--warn)' : 'var(--danger)';
      $('#hDot').style.boxShadow = '0 0 10px ' + $('#hDot').style.background;
      $('#hSub').textContent = `${t('n.lastScan', { t: fmtAgo(s.stats.lastScan) })} · ${t('n.threatsBlocked', { n: fmtNum(s.stats.threatsBlocked) })}`;
      $('#hQuick').innerHTML = `${I('zap', 15)}${t('n.quick')}`;
      $('#hOpen').innerHTML = `${I('external', 14)}${t('n.open')}`;
      this.m.hover.setMood(scanning ? 'scanning' : p.level === 'ok' ? 'happy' : p.level === 'warn' ? 'worried' : 'alarmed');
    },
    onProgress(p) {
      this.scan = p.status === 'done' || p.status === 'canceled' ? null : p;
      const C = 47.1;
      $('#progFg').style.strokeDashoffset = C * (1 - (p.percent || 0));
      $('#progT').textContent = Math.round((p.percent || 0) * 100) + '%';
      if (this.state === 'idle' && this.scan && this.settings.notch.showProgress) { this.setState('progress'); this.m.mini.setMood('scanning'); }
      if (this.state === 'hover') this.renderHover();
    },
    expandFromTile() { if (this.busy) return; this.renderHover(); this.setState('hover'); Sound.play('peek'); },

    // ── wiring ──
    wire() {
      const pill = $('#pill');
      pill.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        if (this.state === 'idle' || this.state === 'progress') {
          dt.haptic && dt.haptic('tick');
          if (this.settings.notch.hoverExpand) { this.renderHover(); this.setState('hover'); } else dt.ui('main:show');
        } else if (this.state === 'hover') this.collapse();
      });
      $('#hQuick').onclick = () => { dt.core('startScan', { type: 'quick' }); dt.ui('main:show', { route: 'scan' }); this.collapse(); };
      $('#hOpen').onclick = () => { dt.ui('main:show'); this.collapse(); };
      $('#alert').onclick = () => { if (this._alertScan) dt.ui('main:show', { route: 'results/' + this._alertScan }); this.alertDone(); };
      dt.on('state', (st) => { const lang = st.settings.lang !== this.settings.lang; const wx = st.settings.notch.weather !== this.settings.notch.weather || st.settings.notch.units !== this.settings.notch.units; const isl = st.settings.notch.style !== this.settings.notch.style; this.st = st; this.applySettings(st.settings); if (lang) { this._tm = null; this.tick(); this.renderWeather(); } if (wx) this.loadWeather(true); if (isl) this.apply(true); if (this.state === 'hover') this.renderHover(); if (this.state === 'idle') this.m.mini.setMood(this.idleMood()); });
      dt.on('scan:start', (p) => this.onProgress(p));
      dt.on('scan:progress', (p) => this.onProgress(p));
      dt.on('scan:done', (sum) => {
        this.scan = null;
        if (this.state === 'progress') {
          this.setState('idle', { cls: sum.threats ? 'glow-bad' : 'glow-ok' });
          this.m.mini.setMood(sum.threats ? 'alarmed' : 'clean');
          setTimeout(() => { if (this.state === 'idle') { $('#pill').className = 's-idle'; this.m.mini.setMood(this.idleMood()); } }, 4000);
        }
      });
      dt.on('notch:alert', (ev) => this.alert(ev));
      dt.on('notch:cmd', (c) => { if (c && c.cmd === 'expand') this.expandFromTile(); });
    },

    // ── drag & drop (cross-app drag on the overlay, in-app drag from the app grid / lists) ──
    xdrag(kind, x, y) {
      if (this.busy) return;
      if (kind === 'start' || kind === 'enter') { if (this.state !== 'drag') this.dragEnter(); }
      else if (kind === 'move') { if (this.state === 'drag') { const r = $('#pill').getBoundingClientRect(); this.m.drop.look((x - (r.left + r.width / 2)) / (r.width / 2), (y - (r.top + r.height / 2)) / 200); } }
      else if (kind === 'leave') { if (this.state === 'drag') this.dragLeave(); }
      else if (kind === 'denied') { this.denied(); }
    },
    xdrop(paths, x, y) { if (this.busy) return; if (this.state !== 'drag') this.dragEnter(); this.handleDrop(paths, x, y); },
    denied() {
      this.setState('result', { cls: 'glow-bad', force: true });
      const L = $('#scanL'); L.className = 'layer on warn';
      this.m.scan.setMood('worried');
      $('#sT').textContent = t('n.denied'); $('#sF').textContent = t('n.deniedSub'); $('#sThr').textContent = ''; $('#sBar').style.display = 'none'; $('#sActs').innerHTML = '';
      Sound.play('error', { gain: .6 });
      setTimeout(() => this.finishDrop(), 2600);
    },
    /** Share sheet → overlay: paper rises from the bottom of the screen into the notch. */
    incoming(paths, names) {
      if (this.busy) return;
      const W = this.W(), H = this.geom.height || 900;
      this.setFull(true);
      setTimeout(() => { this.dragEnter(); setTimeout(() => this.handleDrop(paths, W / 2, H * 0.82, { names }), 380); }, 80);
    },
    dragEnter() {
      this.setState('drag', { cls: 'glow-drag' });
      $('#dropT').textContent = t('n.drop'); $('#dropS').textContent = t('n.dropSub');
      const m = this.m.drop; m.setMood('happy'); m.setMorph(1, 320); setTimeout(() => m.setSlot(0.42), 200);
      Sound.play('peek');
      dt.haptic && dt.haptic('tick');
    },
    dragLeave() {
      const m = this.m.drop; m.setSlot(0); m.setMorph(0, 300);
      this.collapse();
    },
    slotOf(m, cv) {
      const r = cv.getBoundingClientRect();
      const R = Math.min(r.width, r.height) * 0.3;
      const cy = r.top + r.height / 2 + R * 0.12;
      return { x: r.left + r.width / 2, y: cy - R * 0.86 };
    },
    paper(paths, bad, opts = {}) {
      const p = $('#paper');
      const name = (opts.names && opts.names[0]) || opts.name || String(paths[0]).split(/[\\/]/).pop();
      const ext = paths.length > 1 ? paths.length + '×' : (name.includes('.') ? name.split('.').pop().slice(0, 4) : 'FILE');
      $('#paperExt').textContent = ext;
      const icon = $('#paperIcon');
      if (opts.icon) { icon.src = opts.icon; p.classList.add('app'); } else { icon.removeAttribute('src'); p.classList.remove('app'); }
      p.classList.toggle('bad', !!bad);
      return p;
    },
    /** paths: file paths / content URIs / app://pkg. opts: { icon, name, names, back:{x,y} } */
    async handleDrop(paths, x, y, opts = {}) {
      this.busy = true; this._drop = { paths, x, y, opts };
      const m = this.m.drop, cv = $('#dropM');
      const paper = this.paper(paths, false, opts);
      const slot = this.slotOf(m, cv);
      const PW = 46, PH = 58;
      Sound.play('attach');
      dt.haptic && dt.haptic('heavy');
      const scanP = dt.core('scanPaths', paths, { source: 'notch' }).catch(() => null);
      paper.style.opacity = 1;
      const startX = Math.max(0, x - PW / 2), startY = Math.max(0, y - PH / 2);
      const aboveX = slot.x - PW / 2, aboveY = slot.y - PH - 4;
      const far = Math.hypot(aboveX - startX, aboveY - startY);
      await paper.animate([
        { transform: `translate(${startX}px, ${startY}px) rotate(-8deg) scale(1.08)`, clipPath: 'inset(0 0 0 0)' },
        { transform: `translate(${aboveX}px, ${aboveY}px) rotate(0deg) scale(1)`, clipPath: 'inset(0 0 0 0)' },
      ], { duration: Math.min(620, 300 + far * 0.35), easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }).finished;
      m.setSlot(0.5);
      await paper.animate([
        { transform: `translate(${aboveX}px, ${aboveY}px)`, clipPath: 'inset(0 0 0 0)' },
        { transform: `translate(${aboveX}px, ${aboveY + PH}px)`, clipPath: `inset(0 0 ${PH}px 0)` },
      ], { duration: 300, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' }).finished;
      paper.style.opacity = 0;
      m.gulp(); Sound.play('gulp');
      await new Promise(r => setTimeout(r, 380));
      m.setMorph(0, 300);
      if (this._full) this.setFull(false);
      const sm = this.m.scan;
      sm.setMood('scanning'); sm.morph = 0; sm.slotH = 0; sm.slotHTarget = 0;
      $('#scanL').className = 'layer';
      $('#sT').textContent = t('n.scanning');
      const label = (opts.names && opts.names.length === 1 && opts.names[0]) || opts.name || String(paths[0]).split(/[\\/]/).pop();
      $('#sF').textContent = paths.length > 1 ? t('n.multi', { n: paths.length }) : midEllipsis(label, 40);
      $('#sThr').textContent = ''; $('#sBar').style.display = ''; $('#sActs').innerHTML = '';
      this.setState('scan');
      Sound.play('search', { gain: 0.8 });
      const t0 = Date.now();
      const r = await scanP;
      await new Promise(res => setTimeout(res, Math.max(0, 1300 - (Date.now() - t0))));
      this.showResult(r, paths, x, y, opts);
    },
    showResult(r, paths, x, y, opts = {}) {
      const sm = this.m.scan;
      const res = (r && r.results) || [];
      const worst = res.find(i => i.verdict === 'malicious') || res.find(i => i.verdict === 'suspicious');
      const L = $('#scanL');
      $('#sBar').style.display = 'none';
      const back = opts.back || { x, y };
      if (!res.length || res.every(i => i.verdict === 'error')) { this.denied(); return; }
      if (!worst) {
        L.className = 'layer on ok';
        this.setState('result', { cls: 'glow-ok', force: true });
        sm.setMood('clean');
        $('#sT').innerHTML = `${t('n.clean')}<span class="emoji">✨</span>`;
        $('#sThr').textContent = '';
        const isApp = String(paths[0]).startsWith('app://');
        $('#sF').textContent = paths.length > 1 ? `${t('n.multi', { n: paths.length })} · ${t('n.cleanSub')}` : (isApp ? t('n.cleanSubApp') : t('n.cleanSub'));
        Sound.play('finish');
        dt.emit && dt.emit('notch:result', { clean: true, r });
        setTimeout(() => this.flyOut(paths, back.x, back.y, false, opts).then(() => setTimeout(() => this.finishDrop(), 900)), 1500);
        return;
      }
      const bad = worst.verdict === 'malicious';
      const isApp = worst.kind === 'app' || String(worst.path).startsWith('app://');
      this.resultBad = true;
      L.className = 'layer on ' + (bad ? 'bad' : 'warn');
      this.setState('result', { cls: 'bad glow-bad shake', force: true });
      setTimeout(() => $('#pill').classList.remove('shake'), 600);
      sm.setMood(bad ? 'alarmed' : 'worried');
      $('#sT').innerHTML = `${bad ? t('n.malicious') : t('n.suspicious')}<span class="emoji">${bad ? '🚨' : '⚠️'}</span>`;
      $('#sF').textContent = midEllipsis(worst.name, 40);
      $('#sThr').textContent = `${worst.threat} · ${worst.score}/100`;
      Sound.play(bad ? 'alarm' : 'approval');
      dt.haptic && dt.haptic('double');
      dt.emit && dt.emit('notch:result', { clean: false, r });
      $('#sActs').innerHTML = isApp
        ? `<button class="nbtn sm danger" data-a="uninstall">${I('trash', 13)}${t('n.uninstall')}</button><button class="nbtn sm" data-a="ignore">${t('n.ignore')}</button><button class="nbtn sm" data-a="details">${t('n.details')}</button>`
        : `<button class="nbtn sm danger" data-a="quarantine">${I('box', 13)}${t('n.quarantine')}</button><button class="nbtn sm" data-a="ignore">${t('n.ignore')}</button><button class="nbtn sm" data-a="details">${t('n.details')}</button>`;
      const done = async (a) => {
        clearTimeout(this._autoT);
        $('#sActs').innerHTML = '';
        if (a === 'quarantine') {
          const threats = res.filter(i => i.verdict !== 'clean' && i.verdict !== 'error');
          for (const it of threats) await dt.core('applyAction', { scanId: r.id, path: it.path, action: 'quarantine' });
          sm.setMood('clean'); Sound.play('proud');
          $('#scanL').className = 'layer on ok';
          $('#sT').innerHTML = `${t('n.quarantined')}<span class="emoji">🔒</span>`;
          $('#pill').classList.remove('glow-bad'); $('#pill').classList.add('glow-ok');
          setTimeout(() => this.finishDrop(), 1800);
        } else if (a === 'uninstall') {
          await dt.core('applyAction', { scanId: r.id, path: worst.path, action: 'uninstall' });
          sm.setMood('happy');
          await this.flyOut(paths, back.x, back.y, true, opts);
          setTimeout(() => this.finishDrop(), 500);
        } else if (a === 'ignore') {
          for (const it of res.filter(i => i.verdict !== 'clean')) await dt.core('applyAction', { scanId: r.id, path: it.path, action: 'ignore' });
          sm.setMood('happy');
          await this.flyOut(paths, back.x, back.y, true, opts);
          setTimeout(() => this.finishDrop(), 700);
        } else if (a === 'details') {
          dt.ui('main:show', { route: 'results/' + r.id });
          await this.flyOut(paths, back.x, back.y, true, opts);
          this.finishDrop();
        } else { await this.flyOut(paths, back.x, back.y, true, opts); this.finishDrop(); }
      };
      $('#sActs').querySelectorAll('[data-a]').forEach(b => b.onclick = () => done(b.dataset.a));
      this._autoT = setTimeout(() => done('details-silent'), 20000);
    },
    async flyOut(paths, x, y, bad, opts = {}) {
      const sm = this.m.scan, cv = $('#scanM');
      const overlayFar = HOST === 'overlay' && y > 260;
      if (overlayFar) this.setFull(true);
      sm.setMorph(1, 260); setTimeout(() => sm.setSlot(0.46), 160);
      await new Promise(r => setTimeout(r, 360));
      const slot = this.slotOf(sm, cv);
      const PW = 46, PH = 58;
      const paper = this.paper(paths, bad, opts);
      const sx = slot.x - PW / 2, sy = slot.y;
      paper.style.opacity = 1;
      Sound.play('send');
      await paper.animate([
        { transform: `translate(${sx}px, ${sy}px)`, clipPath: `inset(0 0 ${PH}px 0)` },
        { transform: `translate(${sx}px, ${sy - PH - 6}px)`, clipPath: 'inset(0 0 0 0)' },
      ], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }).finished;
      sm.setSlot(0); sm.setMorph(0, 300); sm.jump();
      const W = this.W();
      const tx = Math.min(Math.max(x - PW / 2, 12), W - PW - 12), ty = Math.max(y - PH / 2, 120);
      const home = !!opts.back; // in-app: lands exactly back on the card it came from
      await paper.animate(home ? [
        { transform: `translate(${sx}px, ${sy - PH - 6}px) rotate(0) scale(1)`, opacity: 1 },
        { transform: `translate(${(sx + tx) / 2 + 24}px, ${Math.min(sy + 40, ty)}px) rotate(10deg) scale(1.06)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${tx}px, ${ty}px) rotate(0deg) scale(1)`, opacity: 1, offset: 0.92 },
        { transform: `translate(${tx}px, ${ty}px) rotate(0deg) scale(.9)`, opacity: 0 },
      ] : [
        { transform: `translate(${sx}px, ${sy - PH - 6}px) rotate(0) scale(1)`, opacity: 1 },
        { transform: `translate(${(sx + tx) / 2 + 30}px, ${sy - PH - 30}px) rotate(14deg) scale(1.05)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${tx}px, ${ty}px) rotate(-10deg) scale(.7)`, opacity: 0 },
      ], { duration: home ? 760 : 720, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'forwards' }).finished;
      paper.style.opacity = 0;
      dt.emit && dt.emit('notch:landed', { paths });
      if (overlayFar) this.setFull(false);
    },
    finishDrop() {
      this.busy = false; this.resultBad = false;
      $('#pill').classList.remove('glow-ok', 'glow-bad', 'bad');
      if (this._full) this.setFull(false);
      this.collapse();
      dt.emit && dt.emit('notch:finished', {});
    },
    alert(ev) {
      if (this.busy) return;
      const it = ev.item || {};
      this._alertScan = ev.scanId;
      $('#aT').textContent = ev.action === 'quarantined' ? `${t('n.alertTitle')} · ${t('n.quarantined')}` : (it.verdict === 'malicious' ? t('n.malicious') : t('n.suspicious'));
      $('#aS').textContent = it.name || '';
      $('#aTh').textContent = `${it.threat || ''}${it.score ? ' · ' + it.score + '/100' : ''}`;
      this.setState('alert', { cls: 'glow-bad shake', force: true });
      setTimeout(() => $('#pill').classList.remove('shake'), 600);
      this.m.alert.setMood(ev.action === 'quarantined' ? 'angry' : 'alarmed');
      Sound.play('alarm');
      dt.haptic && dt.haptic('double');
      clearTimeout(this._alertT);
      this._alertT = setTimeout(() => this.alertDone(), 8000);
    },
    alertDone() { clearTimeout(this._alertT); if (this.state === 'alert') this.collapse(); },
  };
  window.NotchDemo = {
    hover: () => { N.renderHover(); N.setState('hover'); },
    drag: () => N.dragEnter(),
    drop: (paths, x = 200, y = 400, opts) => { N.dragEnter(); setTimeout(() => N.handleDrop(paths, x, y, opts), 500); },
    alert: (ev) => N.alert(ev),
    idle: () => { N.busy = false; N.collapse(); },
  };
  window.addEventListener('DOMContentLoaded', () => N.init());
})();
