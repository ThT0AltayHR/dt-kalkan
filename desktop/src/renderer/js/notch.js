/* Dynamic notch / island */
(function () {
  'use strict';
  const { t, $, esc, Sound, fmtAgo, fmtNum, midEllipsis } = UI;
  const I = (n, s) => Icons.icon(n, s);
  const SIZES = { idle: [360, 56], progress: [360, 56], hover: [640, 236], drag: [640, 330], scan: [640, 330], result: [640, 330], alert: [600, 160] };
  const N = window.Notch = {
    state: 'idle', settings: null, st: null, weather: null, scan: null, dragDepth: 0, busy: false,
    async init() {
      this.st = await dt.core('getState');
      this.applySettings(this.st.settings);
      this.m = {
        mini: new Mochi($('#miniM'), { size: 34, mood: 'idle', mini: true, noShadow: true }),
        hover: new Mochi($('#hoverM'), { size: 76, mood: 'happy', noShadow: true }),
        drop: new Mochi($('#dropM'), { size: 116, mood: 'happy', noShadow: true }),
        scan: new Mochi($('#scanM'), { size: 116, mood: 'scanning', noShadow: true }),
        alert: new Mochi($('#alertM'), { size: 80, mood: 'angry', noShadow: true }),
      };
      this.pauseHidden();
      this.tick(); setInterval(() => this.tick(), 1000);
      this.loadWeather(); setInterval(() => this.loadWeather(), 30 * 60000);
      this.wire();
      if (this.st.scan) this.onProgress(this.st.scan);
      this.renderHover();
      // greet once after onboarding/startup
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
    // ── state machine ──
    setState(s, opts = {}) {
      const prev = this.state;
      if (prev === s && !opts.force) return;
      this.state = s;
      const pill = $('#pill');
      const [w, h] = SIZES[s];
      const grow = SIZES[s][1] >= SIZES[prev][1] || SIZES[s][0] >= SIZES[prev][0];
      clearTimeout(this._shrinkT);
      if (grow) dt.ui('notch:size', { w, h });
      else this._shrinkT = setTimeout(() => dt.ui('notch:size', { w, h }), 560);
      pill.className = 's-' + s + (opts.cls ? ' ' + opts.cls : '');
      const layer = { idle: 'idle', progress: 'idle', hover: 'hover', drag: 'drop', scan: 'scanL', result: 'scanL', alert: 'alert' }[s];
      for (const id of ['idle', 'hover', 'drop', 'scanL', 'alert']) $('#' + id).classList.toggle('on', id === layer);
      this.pauseHidden();
      if (s === 'idle' || s === 'progress' || s === 'drag') this.setIgnore(false);
      if ((prev === 'idle' || prev === 'progress') && s === 'hover') Sound.play('open', { gain: 0.7 });
      if (prev === 'hover' && (s === 'idle' || s === 'progress')) Sound.play('close', { gain: 0.6 });
    },
    collapse() {
      if (this.busy) return;
      this.setState(this.scan && this.settings.notch.showProgress ? 'progress' : 'idle');
      this.m.mini.setMood(this.idleMood());
    },
    setIgnore(v) { if (this._ign === v) return; this._ign = v; dt.ui('notch:mouse', { ignore: v }); },

    // ── idle content ──
    tick() {
      const now = new Date();
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
      $('#wx').innerHTML = w ? `${Icons.weatherIcon(w.code, w.isDay, 18)}<span>${Math.round(w.temp)}${u}</span>` : `<span style="opacity:.55">${I('shieldCheck', 16)}</span>`;
      $('#wcard').innerHTML = w
        ? `${Icons.weatherIcon(w.code, w.isDay, 34)}<div class="wt">${Math.round(w.temp)}°</div><div class="wd" style="min-width:0"><b>${esc(w.city || '')}</b><br>${t('n.feels', { t: Math.round(w.feels) + '°' })} · ↑${Math.round(w.max)}° ↓${Math.round(w.min)}°</div>`
        : `${I('location', 22)}<div class="wd">${t('n.weatherOff')}</div>`;
    },
    renderHover() {
      const st = this.st, p = st.protection, s = st.settings;
      const scanning = this.scan;
      $('#hTitle').textContent = scanning ? t('side.scanning', { p: Math.round(scanning.percent * 100) }) : p.level === 'ok' ? t('n.protected') : p.level === 'warn' ? t('side.attention') : t('side.atRisk');
      $('#hDot').style.background = p.level === 'ok' ? 'var(--ok)' : p.level === 'warn' ? 'var(--warn)' : 'var(--danger)';
      $('#hDot').style.boxShadow = '0 0 10px ' + $('#hDot').style.background;
      $('#hSub').textContent = `${t('n.lastScan', { t: fmtAgo(s.stats.lastScan) })} · ${t('n.threatsBlocked', { n: fmtNum(s.stats.threatsBlocked) })}`;
      $('#hQuick').innerHTML = `${I('zap', 16)}${t('n.quick')}`;
      $('#hOpen').innerHTML = `${I('external', 15)}${t('n.open')}`;
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

    // ── wiring ──
    wire() {
      const pill = $('#pill');
      pill.addEventListener('mouseenter', () => {
        clearTimeout(this._leaveT);
        if ((this.state === 'idle' || this.state === 'progress') && this.settings.notch.hoverExpand) {
          this._enterT = setTimeout(() => { this.renderHover(); this.setState('hover'); }, 140);
        }
      });
      pill.addEventListener('mouseleave', () => {
        clearTimeout(this._enterT);
        if (this.state === 'hover') this._leaveT = setTimeout(() => this.collapse(), 380);
      });
      pill.addEventListener('click', (e) => {
        if (this.state === 'idle' || this.state === 'progress') { if (!this.settings.notch.hoverExpand) { this.renderHover(); this.setState('hover'); } else dt.ui('main:show'); }
      });
      document.addEventListener('mousemove', (e) => {
        if (['hover', 'scan', 'result', 'alert'].includes(this.state)) {
          const r = pill.getBoundingClientRect();
          const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
          this.setIgnore(!over);
          if (!over && this.state === 'hover' && !this._leaveT) this._leaveT = setTimeout(() => { this._leaveT = null; this.collapse(); }, 380);
        }
      });
      $('#hQuick').onclick = () => { dt.core('startScan', { type: 'quick' }); dt.ui('main:show', { route: 'scan' }); this.collapse(); };
      $('#hOpen').onclick = () => { dt.ui('main:show'); this.collapse(); };
      $('#alert').onclick = () => { if (this._alertScan) dt.ui('main:show', { route: 'results/' + this._alertScan }); this.alertDone(); };

      // drag & drop (from Explorer or from the app's own lists)
      const isFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
      window.addEventListener('dragenter', (e) => {
        if (!isFiles(e) || this.busy) return; e.preventDefault();
        if (++this.dragDepth === 1) this.dragEnter();
      });
      window.addEventListener('dragover', (e) => { if (!isFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = this.busy ? 'none' : 'copy'; if (this.state === 'drag') this.m.drop.look((e.clientX - 320) / 320, (e.clientY - 120) / 200); });
      window.addEventListener('dragleave', (e) => { if (!isFiles(e) || this.busy) return; if (--this.dragDepth <= 0) { this.dragDepth = 0; this.dragLeave(); } });
      window.addEventListener('drop', (e) => {
        if (!isFiles(e)) return; e.preventDefault(); this.dragDepth = 0;
        if (this.busy) return;
        const paths = [...e.dataTransfer.files].map(f => dt.pathForFile(f)).filter(Boolean);
        if (!paths.length) return this.dragLeave();
        this.handleDrop(paths, e.clientX, e.clientY);
      });

      dt.on('state', (st) => { const lang = st.settings.lang !== this.settings.lang; const wx = st.settings.notch.weather !== this.settings.notch.weather || st.settings.notch.units !== this.settings.notch.units; this.st = st; this.applySettings(st.settings); if (lang) { this._tm = null; this.tick(); this.renderWeather(); } if (wx) this.loadWeather(true); if (this.state === 'hover') this.renderHover(); if (this.state === 'idle') this.m.mini.setMood(this.idleMood()); });
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
    },
    dragEnter() {
      clearTimeout(this._leaveT); clearTimeout(this._enterT);
      this.setState('drag', { cls: 'glow-drag' });
      $('#dropT').textContent = t('n.drop'); $('#dropS').textContent = t('n.dropSub');
      const m = this.m.drop; m.setMood('happy'); m.setMorph(1, 320); setTimeout(() => m.setSlot(0.42), 200);
      Sound.play('peek');
    },
    dragLeave() {
      const m = this.m.drop; m.setSlot(0); m.setMorph(0, 300);
      this.collapse();
    },
    // slot position (window coords) of a mascot canvas
    slotOf(m, cv) {
      const r = cv.getBoundingClientRect();
      const R = Math.min(r.width, r.height) * 0.3;
      const cy = r.top + r.height / 2 + R * 0.12;
      return { x: r.left + r.width / 2, y: cy - R * 0.86 };
    },
    paper(paths, bad) {
      const p = $('#paper');
      const name = paths[0].split(/[\\/]/).pop();
      const ext = paths.length > 1 ? paths.length + '×' : (name.includes('.') ? name.split('.').pop().slice(0, 4) : 'FILE');
      $('#paperExt').textContent = ext;
      p.classList.toggle('bad', !!bad);
      return p;
    },
    async handleDrop(paths, x, y) {
      this.busy = true;
      const m = this.m.drop, cv = $('#dropM');
      const paper = this.paper(paths);
      const slot = this.slotOf(m, cv);
      const PW = 46, PH = 58;
      Sound.play('attach');
      const scanP = dt.core('scanPaths', paths, { source: 'notch' }).catch(() => null);
      paper.style.opacity = 1;
      const startX = Math.max(0, x - PW / 2), startY = Math.max(0, y - PH / 2);
      const aboveX = slot.x - PW / 2, aboveY = slot.y - PH - 4;
      await paper.animate([
        { transform: `translate(${startX}px, ${startY}px) rotate(-8deg) scale(1.08)`, clipPath: 'inset(0 0 0 0)' },
        { transform: `translate(${aboveX}px, ${aboveY}px) rotate(0deg) scale(1)`, clipPath: 'inset(0 0 0 0)' },
      ], { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }).finished;
      m.setSlot(0.5);
      await paper.animate([
        { transform: `translate(${aboveX}px, ${aboveY}px)`, clipPath: 'inset(0 0 0 0)' },
        { transform: `translate(${aboveX}px, ${aboveY + PH}px)`, clipPath: `inset(0 0 ${PH}px 0)` },
      ], { duration: 300, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' }).finished;
      paper.style.opacity = 0;
      m.gulp(); Sound.play('gulp');
      await new Promise(r => setTimeout(r, 380));
      m.setMorph(0, 300);
      // scanning view
      const sm = this.m.scan;
      sm.setMood('scanning'); sm.morph = 0; sm.slotH = 0; sm.slotHTarget = 0;
      $('#scanL').className = 'layer';
      $('#sT').textContent = t('n.scanning');
      $('#sF').textContent = paths.length > 1 ? t('n.multi', { n: paths.length }) : midEllipsis(paths[0].split(/[\\/]/).pop(), 48);
      $('#sThr').textContent = ''; $('#sBar').style.display = ''; $('#sActs').innerHTML = '';
      this.setState('scan');
      Sound.play('search', { gain: 0.8 });
      const t0 = Date.now();
      const r = await scanP;
      await new Promise(res => setTimeout(res, Math.max(0, 1200 - (Date.now() - t0))));
      this.showResult(r, paths, x, y);
    },
    showResult(r, paths, x, y) {
      const sm = this.m.scan;
      const res = (r && r.results) || [];
      const worst = res.find(i => i.verdict === 'malicious') || res.find(i => i.verdict === 'suspicious');
      const L = $('#scanL');
      $('#sBar').style.display = 'none';
      if (!worst) {
        L.className = 'layer on ok';
        this.setState('result', { cls: 'glow-ok', force: true });
        sm.setMood('clean');
        $('#sT').innerHTML = `${t('n.clean')}<span class="emoji">✨</span>`;
        $('#sThr').textContent = '';
        $('#sF').textContent = paths.length > 1 ? `${t('n.multi', { n: paths.length })} · ${t('n.cleanSub')}` : t('n.cleanSub');
        Sound.play('finish');
        setTimeout(() => this.flyOut(paths, x, y, false).then(() => setTimeout(() => this.finishDrop(), 900)), 1500);
        return;
      }
      const bad = worst.verdict === 'malicious';
      L.className = 'layer on ' + (bad ? 'bad' : 'warn');
      this.setState('result', { cls: 'bad glow-bad shake', force: true });
      setTimeout(() => $('#pill').classList.remove('shake'), 600);
      sm.setMood(bad ? 'alarmed' : 'worried');
      $('#sT').innerHTML = `${bad ? t('n.malicious') : t('n.suspicious')}<span class="emoji">${bad ? '🚨' : '⚠️'}</span>`;
      $('#sF').textContent = midEllipsis(worst.name, 48);
      $('#sThr').textContent = `${worst.threat} · ${worst.score}/100`;
      Sound.play(bad ? 'alarm' : 'approval');
      $('#sActs').innerHTML = `<button class="nbtn sm danger" data-a="quarantine">${I('box', 14)}${t('n.quarantine')}</button><button class="nbtn sm" data-a="ignore">${t('n.ignore')}</button><button class="nbtn sm" data-a="details">${t('n.details')}</button>`;
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
        } else if (a === 'ignore') {
          for (const it of res.filter(i => i.verdict !== 'clean')) await dt.core('applyAction', { scanId: r.id, path: it.path, action: 'ignore' });
          sm.setMood('happy');
          await this.flyOut(paths, x, y, true);
          setTimeout(() => this.finishDrop(), 700);
        } else if (a === 'details') {
          dt.ui('main:show', { route: 'results/' + r.id });
          await this.flyOut(paths, x, y, true);
          this.finishDrop();
        } else this.finishDrop();
      };
      $('#sActs').querySelectorAll('[data-a]').forEach(b => b.onclick = () => done(b.dataset.a));
      this._autoT = setTimeout(() => done('details-silent'), 20000);
    },
    async flyOut(paths, x, y, bad) {
      const sm = this.m.scan, cv = $('#scanM');
      sm.setMorph(1, 260); setTimeout(() => sm.setSlot(0.46), 160);
      await new Promise(r => setTimeout(r, 360));
      const slot = this.slotOf(sm, cv);
      const PW = 46, PH = 58;
      const paper = this.paper(paths, bad);
      const sx = slot.x - PW / 2, sy = slot.y;
      paper.style.opacity = 1;
      Sound.play('send');
      await paper.animate([
        { transform: `translate(${sx}px, ${sy}px)`, clipPath: `inset(0 0 ${PH}px 0)` },
        { transform: `translate(${sx}px, ${sy - PH - 6}px)`, clipPath: 'inset(0 0 0 0)' },
      ], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }).finished;
      sm.setSlot(0); sm.setMorph(0, 300); sm.jump();
      const tx = Math.min(Math.max(x - PW / 2, 20), 580), ty = Math.max(y, 250);
      await paper.animate([
        { transform: `translate(${sx}px, ${sy - PH - 6}px) rotate(0) scale(1)`, opacity: 1 },
        { transform: `translate(${(sx + tx) / 2 + 30}px, ${sy - PH - 30}px) rotate(14deg) scale(1.05)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${tx}px, ${ty}px) rotate(-10deg) scale(.7)`, opacity: 0 },
      ], { duration: 720, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'forwards' }).finished;
      paper.style.opacity = 0;
    },
    finishDrop() {
      this.busy = false;
      $('#pill').classList.remove('glow-ok', 'glow-bad', 'bad');
      this.collapse();
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
      clearTimeout(this._alertT);
      this._alertT = setTimeout(() => this.alertDone(), 8000);
    },
    alertDone() { clearTimeout(this._alertT); if (this.state === 'alert') this.collapse(); },
  };
  // demo hooks used for product screenshots
  window.NotchDemo = {
    hover: () => { N.renderHover(); N.setState('hover'); },
    drag: () => N.dragEnter(),
    drop: (paths, x = 330, y = 120) => { N.dragEnter(); setTimeout(() => N.handleDrop(paths, x, y), 500); },
    alert: (ev) => N.alert(ev),
    idle: () => { N.busy = false; N.collapse(); },
  };
  window.addEventListener('DOMContentLoaded', () => N.init());
})();
