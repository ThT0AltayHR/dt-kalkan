/* DT Kalkan — main window controller (Android phone layout of the desktop renderer) */
(function () {
  'use strict';
  const { t, $, $$, esc, h, Sound, fmtBytes, fmtNum, fmtAgo, fmtDur, fmtIn, fmtDate, fmtTime, midEllipsis, errText } = UI;
  const I = (n, s, c) => Icons.icon(n, s, c);

  const App = window.App = {
    state: null, info: null, view: 'dashboard', route: 'dashboard', canvases: new Map(), resultsCache: null,
    async init() {
      this.info = await dt.ui('app:info');
      I18N.setApp(this.info.product.name);
      document.title = this.info.product.name;
      this.state = await dt.core('getState');
      this.applySettings(this.state.settings);
      this.wireChrome();
      this.wireEvents();
      this.buildNav();
      const q = new URLSearchParams(location.search);
      const route = q.get('route') || 'dashboard';
      this.go(route, true);
      this.updateSide();
      if (!this.state.settings.onboarded) Onboarding.start({ intro: true });
      Sound.preload(['pop', 'search', 'finish', 'alarm', 'greet']);
    },
    applySettings(s) {
      I18N.setLang(s.lang);
      document.documentElement.lang = s.lang;
      UI.applyAppearance(s);
      Sound.set(s.sound);
    },
    // ── persistent mascot canvases (survive re-renders) ──
    mochi(key, mood, size) {
      let e = this.canvases.get(key);
      if (!e) {
        const cv = document.createElement('canvas');
        cv.style.width = size + 'px'; cv.style.height = size + 'px';
        const m = new Mochi(cv, { size, mood });
        e = { cv, m, mood }; this.canvases.set(key, e);
      } else if (e.mood !== mood) { e.m.setMood(mood); e.mood = mood; }
      return e;
    },
    place(root) {
      for (const ph of $$('[data-mochi]', root)) {
        const [key, mood, size] = ph.dataset.mochi.split(':');
        const e = this.mochi(key, mood, +size);
        ph.replaceWith(e.cv);
        e.cv.id = ph.id || '';
        e.cv.className = ph.className;
      }
    },
    wireChrome() {
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.back(); });
      dt.on('perm:status', (p) => { if (this.state) { this.state.perms = p; if (this.view === 'settings') Settings.onState(this.state); } });
    },
    /** Android back button: close overlays, then go up one level. Returns false when the app should go to background. */
    back() {
      if ($('#modal').classList.contains('show')) { this.closeModal(false); return true; }
      if ($('#sheet').classList.contains('show')) { this.closeSheet(); return true; }
      if ($('#onboard').classList.contains('show')) return true;
      if (window.InAppNotch && InAppNotch.back()) return true;
      if (this.view === 'settings' && Settings.cat) { Settings.cat = null; Settings.render(); return true; }
      if (this.view === 'results') { this.go(this._from || 'scan'); return true; }
      if (this.view === 'history') { this.go('dashboard'); return true; }
      if (this.view !== 'dashboard') { this.go('dashboard'); return true; }
      return false;
    },
    buildNav() {
      const items = [['dashboard', 'home'], ['scan', 'scan'], ['apps', 'grid'], ['quarantine', 'box'], ['settings', 'settings']];
      $('#nav').innerHTML = items.map(([k, ic]) => `<button class="nav-item" data-nav="${k}">${I(ic, 22)}<span>${t('tab.' + k)}</span>${k === 'quarantine' ? '<span class="badge neutral" id="qBadge" style="display:none"></span>' : ''}</button>`).join('');
      $$('#nav [data-nav]').forEach(b => b.onclick = () => { if (b.dataset.nav === 'settings') Settings.cat = null; this.go(b.dataset.nav); });
      this.updateNavBadges();
      this.markNav();
    },
    markNav() { const v = this.view; const k = v === 'results' ? 'scan' : v === 'history' ? 'dashboard' : v; $$('#nav [data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === k)); },
    updateNavBadges() {
      const b = $('#qBadge'); if (!b) return;
      const n = this.state.quarantine.count;
      b.style.display = n ? '' : 'none'; b.textContent = n;
    },
    go(route, initial) {
      const [view, arg] = route.split('/');
      if (view === 'results' && this.view !== 'results') this._from = this.route;
      this.route = route; this.view = view;
      this.markNav();
      $$('.view').forEach(v => v.classList.toggle('active', v.id === 'v-' + view));
      const el = $('#v-' + view);
      if (el) el.scrollTop = 0;
      if (view === 'dashboard') this.renderDashboard();
      else if (view === 'scan') this.renderScan();
      else if (view === 'results') this.renderResults(arg);
      else if (view === 'quarantine') this.renderQuarantine();
      else if (view === 'history') this.renderHistory();
      else if (view === 'settings') Settings.render(arg);
      else if (view === 'apps') Apps.render();
      if (!initial) { Sound.play('hover', { gain: 0.5 }); dt.haptic('tick'); }
    },
    rerender() { this.buildNav(); this.go(this.route, true); this.updateSide(); },
    wireEvents() {
      dt.on('navigate', (r) => this.go(r));
      dt.on('state', (st) => {
        const langChanged = st.settings.lang !== this.state.settings.lang;
        this.state = st; this.applySettings(st.settings);
        this.updateSide(); this.updateNavBadges();
        if (langChanged) return this.rerender();
        if (this.view === 'dashboard') this.renderDashboard();
        if (this.view === 'quarantine') this.renderQuarantine();
        if (this.view === 'settings') Settings.onState(st);
      });
      dt.on('scan:start', (p) => { this.state.scan = p; this.updateSide(); if (this.view === 'scan' || this.view === 'dashboard') this.go('scan', true); });
      dt.on('scan:progress', (p) => { this.state.scan = p; this.updateScanProgress(p); this.updateSide(); });
      dt.on('scan:threat', ({ item, scanId }) => { if (this.view === 'scan' && scanId && scanId[0] === 'S') this.addLiveThreat(item); });
      dt.on('scan:done', (sum) => {
        this.state.scan = null; this.updateSide();
        if (this.view === 'scan' && document.hasFocus()) this.go('results/' + sum.id, true);
        else if (this.view === 'scan') this.renderScan();
      });
      dt.on('history', () => { if (this.view === 'history') this.renderHistory(); if (this.view === 'dashboard') this.renderDashboard(); });
      dt.on('quarantine', () => { if (this.view === 'quarantine') this.renderQuarantine(); if (this.view === 'results') this.renderResults(this.route.split('/')[1], true); });
      dt.on('update:progress', (p) => Settings.onUpdateProgress && Settings.onUpdateProgress(p));
    },
    // ── sidebar status ──
    updateSide() { /* phone layout has no sidebar; status lives in the dashboard hero and the notch */ },

    // ───────── Dashboard ─────────
    renderDashboard() {
      const st = this.state, s = st.settings, p = st.protection;
      const scanning = !!st.scan;
      const lvl = scanning ? 'ok' : p.level;
      const mood = scanning ? 'scanning' : lvl === 'ok' ? 'cool' : lvl === 'warn' ? 'worried' : 'alarmed';
      const title = scanning ? t('dash.scanning.title') : t('dash.' + lvl + '.title');
      const issues = scanning ? [] : p.issues;
      const recent = (this._recent || []).slice(0, 5);
      const lastTs = s.stats.lastScan;
      const el = $('#v-dashboard');
      el.innerHTML = `
        <div class="m-top"><div class="m-brand"><img src="img/logo.svg" alt=""><span>${esc(this.info.product.name.split(' ')[0])} <b>${esc(this.info.product.name.split(' ').slice(1).join(' '))}</b></span></div><button class="icon-btn" data-go="history" aria-label="${t('dash.history')}">${I('history', 20)}</button></div>
        <div class="hero ${lvl}">
          <div class="hero-m"><div class="ring"></div><div class="ring r2"></div><div data-mochi="hero:${mood}:170"></div></div>
          <div style="flex:1;min-width:0">
            <h2>${title}</h2>
            <div class="hero-sub">${scanning ? esc(t('scan.running.' + (st.scan.type === 'full' ? 'full' : st.scan.type === 'custom' ? 'custom' : 'quick'))) + ' · %' + Math.round(st.scan.percent * 100) : t('dash.ok.sub', { last: fmtAgo(lastTs) })}</div>
            ${issues.length ? `<div class="issues">${issues.map(i => `<div class="issue">${I('alert', 16)}<span>${t('dash.issue.' + i)}</span><a data-fix="${i}">${t('dash.fix')}</a></div>`).join('')}</div>` : ''}
            <div class="hero-actions">
              ${scanning ? `<button class="btn primary lg" data-go="scan">${I('activity', 18)}${t('dash.viewScan')}</button>` : `<button class="btn primary lg" data-scan="quick">${I('zap', 18)}${t('dash.quick')}</button><button class="btn lg" data-scan="full">${I('drive', 18)}${t('dash.full')}</button>`}
            </div>
          </div>
          <div class="hero-badge">${I('shieldCheck', 14)}${st.elevated ? t('dash.badge.allfiles') : t('dash.badge.limited')}</div>
        </div>
        <div class="grid g4" style="margin-top:14px">
          ${this.stat('shield', 'red', t('dash.stat.blocked'), fmtNum(s.stats.threatsBlocked), t('dash.stat.blockedSub'))}
          ${this.stat('fileCheck', '', t('dash.stat.scanned'), fmtNum(s.stats.filesScanned + (s.stats.realtimeScanned || 0)), t('dash.stat.scannedSub', { n: fmtNum(s.stats.realtimeScanned || 0) }))}
          ${this.stat('database', 'blue', t('dash.stat.sigs'), this.compact(st.sig.total), t('dash.stat.sigsSub', { rules: st.sig.rules, date: st.sig.created ? fmtDate(st.sig.created, false) : '—' }))}
          ${this.stat('box', 'violet', t('dash.stat.quarantine'), fmtNum(st.quarantine.count), t('dash.stat.qSub', { size: fmtBytes(st.quarantine.bytes) }))}
        </div>
        <div class="grid dash-cols" style="margin-top: 6px; gap: 18px">
          <div>
            <div class="section-title">${t('dash.modules')}</div>
            <div class="grid" style="gap:10px">
              ${this.mod('realtime', 'shield', t('dash.mod.realtime'), t('dash.mod.realtimeSub', { n: p.watching.length }), s.protection.realtime)}
              ${this.mod('schedule', 'clock', t('dash.mod.schedule'), s.scan.schedule.enabled ? t('dash.mod.scheduleSub', { t: fmtIn(st.nextScheduled) }) : t('common.off'), s.scan.schedule.enabled)}
              ${this.mod('heur', 'cpu', t('dash.mod.heur'), t('dash.mod.heurSub', { s: t('s.scan.heur.' + s.scan.heuristics) }), s.scan.heuristicsEnabled !== false)}
              ${this.mod('notch', 'notch', t('dash.mod.notch'), t('dash.mod.notchSub'), s.notch.enabled)}
            </div>
          </div>
          <div>
            <div class="section-title">${t('dash.recent')}<button class="btn ghost sm" data-go="history">${t('dash.seeAll')}${I('chevronRight', 14)}</button></div>
            <div class="card" style="padding:6px 14px">
              <div class="act-list" id="dashRecent">${recent.length ? recent.map(e => this.histRow(e)).join('') : `<div class="empty" style="padding:26px 0"><span class="dim">${t('dash.recentEmpty')}</span></div>`}</div>
            </div>
            <div class="dropzone" id="dashDrop" style="margin-top:14px" data-go="apps"><div class="dz-ico">${I('grid', 20)}</div><div><b>${t('dash.drop')}</b><span class="dim">${t('dash.dropSub')}</span></div></div>
          </div>
        </div>`;
      this.place(el);
      $$('[data-scan]', el).forEach(b => b.onclick = () => this.startScan(b.dataset.scan));
      $$('[data-go]', el).forEach(b => b.onclick = () => this.go(b.dataset.go));
      $$('[data-fix]', el).forEach(a => a.onclick = () => this.fix(a.dataset.fix));
      $$('[data-mod]', el).forEach(i => i.onchange = () => this.toggleModule(i.dataset.mod, i.checked));
      this.bindHistRows(el);
      if (!this._recent || this._recentAt < Date.now() - 2000) this.loadRecent();
    },
    async loadRecent() { this._recentAt = Date.now(); this._recent = (await dt.core('listHistory')).filter(e => e.type !== 'scan-start'); if (this.view === 'dashboard') { const box = $('#dashRecent'); if (box) { box.innerHTML = this._recent.slice(0, 5).map(e => this.histRow(e)).join('') || `<div class="empty" style="padding:26px 0"><span class="dim">${t('dash.recentEmpty')}</span></div>`; this.bindHistRows(box); } } },
    compact(n) { if (n >= 1e6) return (n / 1e6).toFixed(2).replace('.', I18N.getLang() === 'tr' ? ',' : '.') + (I18N.getLang() === 'tr' ? ' Mn' : 'M'); if (n >= 1e4) return Math.round(n / 1e3) + (I18N.getLang() === 'tr' ? ' B' : 'K'); return fmtNum(n); },
    stat(ic, cls, label, val, sub) { return `<div class="card stat"><div class="st-top"><span>${label}</span><span class="st-ico ${cls}">${I(ic, 17)}</span></div><div class="st-val">${val}</div><div class="st-sub">${esc(sub)}</div></div>`; },
    mod(key, ic, title, sub, on) { return `<div class="mod ${on ? 'on' : ''}"><div class="m-ico">${I(ic, 19)}</div><div class="m-txt"><div class="m-title">${title}</div><div class="m-sub">${esc(sub)}</div></div><label class="toggle"><input type="checkbox" data-mod="${key}" ${on ? 'checked' : ''}><span></span></label></div>`; },
    async toggleModule(k, on) {
      const p = { realtime: { protection: { realtime: on } }, schedule: { scan: { schedule: { enabled: on } } }, heur: { scan: { heuristicsEnabled: on } }, notch: { notch: { enabled: on } } }[k];
      Sound.play('pop', { gain: 0.6 });
      await dt.core('setSettings', p);
    },
    async fix(i) {
      if (i === 'realtime') await dt.core('setSettings', { protection: { realtime: true } });
      else if (i === 'schedule') await dt.core('setSettings', { scan: { schedule: { enabled: true } } });
      else if (i === 'outdated') { this.go('settings/updates'); dt.core('updateSignatures'); }
      else if (i === 'noscan') this.startScan('quick');
      else if (i === 'storage') { await dt.ui('perm:request', { key: 'storage' }); this.state = await dt.core('getState'); this.renderDashboard(); }
    },

    // ───────── Scan ─────────
    async startScan(type, paths) {
      const r = await dt.core('startScan', { type, paths });
      if (r && r.error === 'BUSY') { this.snack(t('scan.busy'), true); this.go('scan'); return; }
      Sound.play('search');
      this.state.scan = { id: r.id, type, percent: 0, scanned: 0, discovered: 0, threats: 0, elapsed: 0, rate: 0, status: 'running', current: '' };
      this._liveThreats = [];
      this.go('scan', true);
    },
    renderScan() {
      const el = $('#v-scan');
      const sc = this.state.scan;
      if (sc) return this.renderScanning(el, sc);
      el.innerHTML = `
        <div class="page-head"><div><h1 class="page">${t('scan.title')}</h1><p class="page-sub">${t('scan.sub')}</p></div></div>
        <div class="scan-cards">
          <div class="scan-card"><div class="sc-ico">${I('zap', 24)}</div><h3>${t('scan.quick')}</h3><p>${t('scan.quickDesc')}</p><div class="sc-meta">${I('clock', 14)}${t('scan.quickTime')}</div><div class="sc-actions"><button class="btn primary" data-scan="quick">${I('play', 15)}${t('scan.start')}</button></div></div>
          <div class="scan-card"><div class="sc-ico">${I('drive', 24)}</div><h3>${t('scan.full')}</h3><p>${t('scan.fullDesc')}</p><div class="sc-meta">${I('clock', 14)}${t('scan.fullTime')}</div><div class="sc-actions"><button class="btn" data-scan="full">${I('play', 15)}${t('scan.start')}</button></div></div>
          <div class="scan-card"><div class="sc-ico">${I('folder', 24)}</div><h3>${t('scan.custom')}</h3><p>${t('scan.customDesc')}</p><div class="sc-actions"><button class="btn" data-pick="files">${I('file', 15)}${t('scan.pickFiles')}</button><button class="btn" data-pick="folders">${I('folder', 15)}${t('scan.pickFolders')}</button></div></div>
        </div>
        <div class="dropzone" id="scanDrop" style="margin-top:14px" data-go="apps"><div class="dz-ico">${I('grid', 22)}</div><div><b>${t('dash.drop')}</b><span class="dim">${t('dash.dropSub')}</span></div></div>
        <div class="engine-strip">${I('cpu', 18)}<div><b style="font-weight:600">${t('scan.engine')}</b><div class="dim" style="font-size:12px;margin-top:2px">${t('scan.engineSub')}</div></div>
          <div class="es-chips"><span class="chip on">${I('database', 13)}${this.compact(this.state.sig.total)}</span><span class="chip on">${I('code', 13)}${this.state.sig.rules} ${I18N.getLang() === 'tr' ? 'kural' : 'rules'}</span></div></div>`;
      $$('[data-scan]', el).forEach(b => b.onclick = () => this.startScan(b.dataset.scan));
      $$('[data-go]', el).forEach(b => b.onclick = () => this.go(b.dataset.go));
      $$('[data-pick]', el).forEach(b => b.onclick = async () => {
        const paths = await dt.ui('pick', { folders: b.dataset.pick === 'folders' });
        if (paths && paths.length) this.startScan('custom', paths);
      });
    },
    renderScanning(el, sc) {
      const C = 2 * Math.PI * 138;
      el.innerHTML = `
        <div class="scanning">
          <div class="prog-wrap">
            <svg class="ring" width="300" height="300"><defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/></linearGradient></defs>
              <circle class="ring-bg" cx="150" cy="150" r="138" fill="none" stroke-width="10"/>
              <circle class="ring-fg" id="ringFg" cx="150" cy="150" r="138" fill="none" stroke-width="10" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>
            <div data-mochi="scan:scanning:170"></div>
            <div class="pct" id="scPct">0<small>%</small></div>
          </div>
          <div class="scan-info">
            <span class="chip on" id="scChip">${I('activity', 13)}<span id="scType"></span></span>
            <h2 id="scTitle"></h2>
            <div class="scan-cur" id="scCur"></div>
            <div class="scan-stats">
              <div class="ss"><div class="ss-l">${t('scan.scanned')}</div><div class="ss-v" id="scN">0</div></div>
              <div class="ss" id="scTBox"><div class="ss-l">${t('scan.found')}</div><div class="ss-v" id="scT">0</div></div>
              <div class="ss"><div class="ss-l">${t('scan.speed')}</div><div class="ss-v" id="scR">—</div></div>
              <div class="ss"><div class="ss-l">${t('scan.elapsed')}</div><div class="ss-v" id="scE">0:00</div></div>
            </div>
            <div style="display:flex;gap:10px">
              <button class="btn" id="scPause">${I('pause', 15)}<span>${t('scan.pause')}</span></button>
              <button class="btn danger" id="scStop">${I('stop', 15)}${t('scan.cancel')}</button>
            </div>
            <div class="section-title" style="margin-top:26px">${t('scan.liveThreats')}</div>
            <div class="table live-threats" id="liveThreats"><div class="empty" style="padding:22px"><span class="dim">${t('scan.liveNone')}</span></div></div>
          </div>
        </div>`;
      this.place(el);
      $('#scPause').onclick = () => { const paused = this.state.scan && this.state.scan.status === 'paused'; dt.core(paused ? 'resumeScan' : 'pauseScan'); };
      $('#scStop').onclick = () => dt.core('cancelScan');
      this._liveThreats = this._liveThreats || [];
      if (sc.id) dt.core('getScan', sc.id).then(d => { if (d && d.threatsList) { this._liveThreats = []; $('#liveThreats').innerHTML = ''; d.threatsList.forEach(i => this.addLiveThreat(i)); if (!d.threatsList.length) $('#liveThreats').innerHTML = `<div class="empty" style="padding:22px"><span class="dim">${t('scan.liveNone')}</span></div>`; } });
      this.updateScanProgress(sc);
    },
    updateScanProgress(p) {
      if (this.view !== 'scan' || !$('#ringFg')) { if (this.view === 'dashboard' && p && $('#v-dashboard .hero-sub')) $('#v-dashboard .hero-sub').textContent = t('scan.running.' + (p.type === 'full' ? 'full' : p.type === 'custom' ? 'custom' : 'quick')) + ' · %' + Math.round(p.percent * 100); return; }
      const C = 2 * Math.PI * 138;
      const pct = Math.round(p.percent * 100);
      $('#ringFg').style.strokeDashoffset = C * (1 - p.percent);
      $('#scPct').innerHTML = `${pct}<small>%</small>`;
      const type = p.type === 'full' ? 'full' : p.type === 'custom' ? 'custom' : 'quick';
      $('#scType').textContent = t('scan.' + type);
      $('#scTitle').textContent = p.status === 'paused' ? t('scan.paused') : t('scan.running.' + type);
      $('#scCur').textContent = p.current ? midEllipsis(p.current, 90) : (p.discoveryDone ? '' : t('scan.discovering'));
      $('#scN').textContent = fmtNum(p.scanned);
      $('#scT').textContent = fmtNum(p.threats);
      $('#scTBox').classList.toggle('bad', p.threats > 0);
      $('#scR').textContent = p.rate ? t('scan.speedVal', { n: fmtNum(p.rate) }) : '—';
      $('#scE').textContent = fmtDur(p.elapsed || 0);
      const paused = p.status === 'paused';
      $('#scPause').innerHTML = paused ? `${I('play', 15)}<span>${t('scan.resume')}</span>` : `${I('pause', 15)}<span>${t('scan.pause')}</span>`;
      const e = this.canvases.get('scan'); if (e) { const mood = p.threats ? 'worried' : paused ? 'sleepy' : 'scanning'; if (e.mood !== mood) { e.m.setMood(mood); e.mood = mood; } }
    },
    addLiveThreat(item) {
      const box = $('#liveThreats'); if (!box) return;
      if (!this._liveThreats.length) box.innerHTML = '';
      if (this._liveThreats.some(x => x.path === item.path)) return;
      this._liveThreats.push(item);
      box.insertAdjacentHTML('beforeend', `<div class="tr" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) 90px"><div class="fcell"><div class="ficon ${item.verdict}">${I(item.verdict === 'malicious' ? 'bug' : 'fileWarn', 17)}</div><div style="min-width:0"><div class="fname">${esc(item.name)}</div><div class="fpath">${esc(item.path)}</div></div></div><div class="tname">${esc(item.threat)}</div><div><span class="vpill ${item.verdict}">${t('verdict.' + item.verdict)}</span></div></div>`);
    },

    // ───────── Results ─────────
    async renderResults(id, keepTab) {
      const el = $('#v-results');
      const doc = await dt.core('getScan', id);
      if (!doc) { this.go('dashboard'); return; }
      await Apps.ensureIcons([...(doc.threatsList || []), ...(doc.items || [])].filter(x => x.pkg).map(x => x.pkg));
      this.resultsDoc = doc;
      const threats = doc.threatsList || [];
      const clean = doc.items || [];
      const pending = threats.filter(x => !x.action).length;
      const bad = threats.length > 0;
      const mood = bad ? (pending ? 'alarmed' : 'proud') : 'clean';
      const typeKey = { quick: 'h.scan.quick', full: 'h.scan.full', custom: 'h.scan.custom', drop: 'h.scan.drop', notch: 'h.scan.notch', realtime: 'tray.realtime' }[doc.type] || 'h.scan.quick';
      const tab = keepTab && this._resTab ? this._resTab : (bad ? 'threats' : 'clean');
      this._resTab = tab;
      const sub = (bad ? 'res.threats.sub' : 'res.clean.sub');
      el.innerHTML = `
        <div class="res-head ${bad ? 'bad' : 'clean'}">
          <div data-mochi="res-${bad ? 'b' : 'c'}:${mood}:130"></div>
          <div style="min-width:0">
            <span class="chip">${esc(t(typeKey))} · ${fmtDate(doc.startedAt)}</span>
            <h2 style="margin-top:10px">${doc.status === 'canceled' ? t('res.canceled') + ' · ' : ''}${bad ? t('res.threats.title', { n: threats.length }) : t('res.clean.title')}</h2>
            <div class="muted">${t(sub, { n: fmtNum(doc.scanned), t: fmtDur(doc.elapsed || 0), p: pending })}</div>
          </div>
          <div class="rh-actions">
            ${bad && pending ? `<button class="btn primary" id="qAll">${I('box', 16)}${t('res.quarantineAll')}</button>` : ''}
            <button class="btn" data-go="dashboard">${t('res.back')}</button>
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div class="tabs"><button class="tab ${tab === 'threats' ? 'active' : ''}" data-tab="threats">${t('res.tabThreats')}<span class="n">${threats.length}</span></button><button class="tab ${tab === 'clean' ? 'active' : ''}" data-tab="clean">${t('res.tabClean')}<span class="n">${fmtNum(doc.cleanCount ?? clean.length)}</span></button></div>
          <span class="dim drag-hint">${I('grip', 14)}${t('res.dragHint')}</span>
        </div>
        <div class="table" id="resTable"></div>`;
      this.place(el);
      $$('[data-go]', el).forEach(b => b.onclick = () => this.go(b.dataset.go));
      $$('[data-tab]', el).forEach(b => b.onclick = () => { this._resTab = b.dataset.tab; $$('[data-tab]', el).forEach(x => x.classList.toggle('active', x === b)); this.fillResTable(); });
      const qa = $('#qAll'); if (qa) qa.onclick = async () => { qa.disabled = true; for (const it of threats.filter(x => !x.action)) await dt.core('applyAction', { scanId: doc.id, path: it.path, action: 'quarantine' }); Sound.play('proud'); this.renderResults(id, true); };
      this.fillResTable();
    },
    fillResTable() {
      const doc = this.resultsDoc, tab = this._resTab;
      const list = tab === 'threats' ? (doc.threatsList || []) : (doc.items || []);
      const box = $('#resTable');
      if (!list.length) { box.innerHTML = `<div class="empty" style="padding:34px"><span class="dim">${tab === 'threats' ? t('scan.liveNone') : t('res.noClean')}</span></div>`; return; }
      const head = `<div class="tr head"><div>${t('res.col.file')}</div><div>${t('res.col.threat')}</div><div>${t('res.col.risk')}</div><div style="text-align:right">${t('res.col.actions')}</div></div>`;
      box.innerHTML = head + list.slice(0, 400).map((it, i) => this.resRow(it, i)).join('') + (tab === 'clean' && (doc.cleanCount || 0) > list.length ? `<div class="empty" style="padding:14px"><span class="dim">${t('res.cleanNote', { n: list.length })}</span></div>` : '');
      $$('.tr.row', box).forEach(r => {
        r.onclick = (e) => { if (e.target.closest('button') || r._dragged) return; r.classList.toggle('open'); };
        const it = list[+r.dataset.i];
        if (window.InAppNotch && !it.action) InAppNotch.draggable(r, () => ({ paths: [it.path], name: it.name, icon: it.kind === 'app' ? (Apps.icons[it.pkg] || null) : null, anchor: r.querySelector('.ficon') }));
      });
      $$('[data-act]', box).forEach(b => b.onclick = (e) => { e.stopPropagation(); this.itemAction(list[+b.dataset.i], b.dataset.act, b); });
    },
    resRow(it, i) {
      const v = it.verdict || 'error';
      const icon = v === 'malicious' ? 'bug' : v === 'suspicious' ? 'fileWarn' : v === 'clean' ? 'fileCheck' : 'file';
      let acts;
      if (it.action) {
        const map = { quarantined: ['box', 'res.st.quarantined'], deleted: ['trash', 'res.st.deleted'], ignored: ['check', 'res.st.ignored'], restored: ['restore', 'res.st.restored'], uninstall: ['trash', 'res.st.uninstall'], failed: ['alert', 'err.generic'] }[it.action] || ['check', 'res.st.ignored'];
        acts = `<span class="state-pill ${it.action !== 'failed' ? 'ok' : ''}">${I(map[0], 14)}${t(map[1])}</span>${it.action === 'quarantined' ? `<button class="btn sm ghost" data-act="restore" data-i="${i}" title="${t('res.act.restore')}">${I('restore', 14)}</button>` : ''}`;
      } else if (it.kind === 'app' && (v === 'clean' || v === 'error')) acts = `<button class="btn sm ghost" data-act="appinfo" data-i="${i}">${I('info', 14)}${t('res.act.appInfo')}</button>`;
      else if (v === 'clean' || v === 'error') acts = `<button class="btn sm ghost" data-act="reveal" data-i="${i}">${I('folder', 14)}${t('res.act.reveal')}</button>`;
      else if (it.kind === 'app') acts = `<button class="btn sm danger" data-act="uninstall" data-i="${i}">${I('trash', 14)}${t('res.act.uninstall')}</button><button class="btn sm" data-act="appinfo" data-i="${i}" title="${t('res.act.appInfo')}">${I('info', 14)}</button><button class="btn sm" data-act="ignore" data-i="${i}" title="${t('res.act.ignore')}">${I('eyeOff', 14)}</button>`;
      else acts = `<button class="btn sm primary" data-act="quarantine" data-i="${i}">${I('box', 14)}${t('res.act.quarantine')}</button><button class="btn sm" data-act="delete" data-i="${i}" title="${t('res.act.delete')}">${I('trash', 14)}</button><button class="btn sm" data-act="ignore" data-i="${i}" title="${t('res.act.ignore')}">${I('eyeOff', 14)}</button>`;
      const score = it.score || 0;
      const reasons = (it.reasons || []).map(r => `<div class="reason"><span class="lbadge ${r.layer}">${t('res.layer.' + r.layer)}</span><span>${esc((r.t && (r.t[I18N.getLang()] || r.t.tr)) || '')}</span>${r.w ? `<span class="w">${r.w > 0 ? '+' : ''}${r.w}</span>` : ''}</div>`).join('');
      return `<div class="tr row v-${v}${it.action ? ' done' : ''}" data-i="${i}">
        <div class="fcell"><div class="ficon ${v} ${it.kind === 'app' ? 'appic' : ''}">${it.kind === 'app' && Apps.icons[it.pkg] ? `<img src="${Apps.icons[it.pkg]}" alt="">` : I(icon, 17)}</div><div style="min-width:0"><div class="fname">${esc(it.name)}</div><div class="fpath" title="${esc(it.path)}">${esc(midEllipsis(it.path, 80))}</div></div></div>
        <div style="min-width:0"><div class="tname" title="${esc(it.threat || '')}">${it.threat ? esc(it.threat) : '<span class="dim">—</span>'}</div><span class="vpill ${v}">${t('verdict.' + v)}</span></div>
        <div class="risk"><div class="bar"><i class="${score < 40 ? 'lo' : ''}" style="width:${Math.max(3, score)}%"></i></div><b>${score}</b></div>
        <div class="acts">${acts}</div>
      </div>
      <div class="details"><div class="dim" style="font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin:4px 0 4px">${t('res.reasons')}</div>${reasons || `<div class="dim">—</div>`}
        <div class="kv"><span>${t('res.size')}: <b>${fmtBytes(it.size)}</b></span>${it.pkg ? `<span>${t('res.app')}: <b>${esc(it.pkg)}</b></span>` : ''}${it.apk && it.apk.permissions && it.apk.permissions.length ? `<span>${t('res.perms')}: <b>${esc(it.apk.permissions.map(p => p.replace('android.permission.', '')).slice(0, 14).join(', '))}</b></span>` : ''}${it.sha256 ? `<span>${t('res.sha')}: <b>${esc(it.sha256)}</b></span>` : ''}</div></div>`;
    },
    async itemAction(it, act, btn) {
      const doc = this.resultsDoc;
      if (act === 'reveal') return dt.ui('reveal', { path: it.path });
      if (act === 'appinfo') return dt.ui('appDetails', { pkg: it.pkg || String(it.path).replace('app://', '') });
      if (act === 'delete' && !(await this.confirm({ title: t('res.act.delete'), body: t('res.confirmDelete', { name: it.name }), ok: t('res.act.delete'), danger: true }))) return;
      if (btn) btn.disabled = true;
      const r = await dt.core('applyAction', { scanId: doc.id, path: it.path, action: act, quarantineId: it.quarantineId });
      if (!r || r.ok === false) { this.snack(errText(r && r.error), true); if (btn) btn.disabled = false; return; }
      Sound.play(act === 'quarantine' ? 'gulp' : 'pop');
      if (act === 'restore') this.snack(t('q.restored', { path: r.restoredTo }));
      this.renderResults(doc.id, true);
    },

    // ───────── Quarantine ─────────
    async renderQuarantine() {
      const el = $('#v-quarantine');
      const items = await dt.core('listQuarantine');
      const total = items.reduce((a, b) => a + (b.size || 0), 0);
      el.innerHTML = `
        <div class="page-head"><div><h1 class="page">${t('q.title')}</h1><p class="page-sub">${t('q.sub')}</p></div>
          <div style="display:flex;gap:8px;align-items:center"><span class="chip">${I('lock', 13)}${t('q.count', { n: items.length, size: fmtBytes(total) })}</span>${items.length ? `<button class="btn danger sm" id="qDelAll">${I('trash', 14)}${t('q.deleteAll')}</button>` : ''}</div></div>
        ${items.length ? `<div class="table"><div class="qrow tr head"><div>${t('res.col.file')}</div><div>${t('res.col.threat')}</div><div>${t('q.date')}</div><div style="text-align:right">${t('res.col.actions')}</div></div>
          ${items.map((q, i) => `<div class="qrow"><div class="fcell"><div class="ficon malicious">${I('lock', 16)}</div><div style="min-width:0"><div class="fname">${esc(q.name)}</div><div class="fpath" title="${esc(q.originalPath)}">${esc(midEllipsis(q.originalPath, 70))}</div></div></div>
            <div style="min-width:0"><div class="tname">${esc(q.threat || '—')}</div><span class="dim" style="font-size:11.5px">${fmtBytes(q.size)}</span></div>
            <div class="dim" style="font-size:12.5px">${fmtDate(q.date)}</div>
            <div class="acts"><button class="btn sm" data-qr="${i}">${I('restore', 14)}${t('q.restore')}</button><button class="btn sm danger" data-qd="${i}" title="${t('q.delete')}">${I('trash', 14)}</button></div></div>`).join('')}</div>`
        : `<div class="empty"><div data-mochi="qempty:sleepy:150"></div><h3>${t('q.empty')}</h3><div>${t('q.emptySub')}</div></div>`}`;
      this.place(el);
      $$('[data-qr]', el).forEach(b => b.onclick = async () => {
        const q = items[+b.dataset.qr];
        if (!(await this.confirm({ title: t('q.restore'), body: t('q.confirmRestore', { name: q.name }), ok: t('q.restore') }))) return;
        const r = await dt.core('restoreQuarantine', q.id);
        if (r && r.ok) { this.snack(t('q.restored', { path: r.restoredTo })); Sound.play('pop'); } else this.snack(errText(r && r.error), true);
        this.renderQuarantine();
      });
      $$('[data-qd]', el).forEach(b => b.onclick = async () => {
        const q = items[+b.dataset.qd];
        if (!(await this.confirm({ title: t('q.delete'), body: t('res.confirmDelete', { name: q.name }), ok: t('q.delete'), danger: true }))) return;
        await dt.core('deleteQuarantine', q.id); Sound.play('pop'); this.renderQuarantine();
      });
      const da = $('#qDelAll'); if (da) da.onclick = async () => { if (await this.confirm({ title: t('q.deleteAll'), body: t('q.confirmDeleteAll'), ok: t('q.deleteAll'), danger: true })) { await dt.core('deleteAllQuarantine'); this.renderQuarantine(); } };
    },

    // ───────── History ─────────
    histMeta(e) {
      const d = e.data || {};
      const typeName = (k) => t({ quick: 'h.scan.quick', full: 'h.scan.full', custom: 'h.scan.custom', drop: 'h.scan.drop', notch: 'h.scan.notch' }[k] || 'h.scan.quick');
      switch (e.type) {
        case 'scan': return { ic: d.threats ? 'shieldAlert' : 'shieldCheck', cls: d.threats ? 'bad' : 'ok', title: t(d.status === 'canceled' ? 'h.scanCanceled' : 'h.scanDone', { type: typeName(d.type) }), sub: t('h.scanDetail', { n: fmtNum(d.scanned), t: d.threats }) + (d.scheduled ? ' · ' + t('h.scheduled') : '') + (d.names ? ' · ' + d.names.join(', ') : ''), link: d.id ? 'results/' + d.id : null, group: 'scans' };
        case 'scan-start': return { ic: 'play', cls: 'info', title: t('h.scanStart', { type: typeName(d.type) }), sub: '', group: 'scans' };
        case 'quarantine': return { ic: 'box', cls: 'ok', title: t('h.quarantine', { name: d.name }), sub: d.threat || '', link: 'quarantine', group: 'threats' };
        case 'delete': return { ic: 'trash', cls: 'ok', title: t('h.delete', { name: d.name }), sub: d.threat || '', group: 'threats' };
        case 'restore': return { ic: 'restore', cls: 'warn', title: t('h.restore', { name: d.name }), sub: d.path || '', group: 'threats' };
        case 'qdelete': return { ic: 'trash', cls: '', title: d.all ? t('h.qdeleteAll') : t('h.qdelete', { name: d.name }), sub: d.threat || '', group: 'threats' };
        case 'ignore': return { ic: 'eyeOff', cls: 'warn', title: t('h.ignore', { name: d.name }), sub: d.threat || '', group: 'threats' };
        case 'realtime': return { ic: 'shieldAlert', cls: 'bad', title: t('h.realtime', { name: d.name }), sub: (d.threat || '') + (d.action === 'quarantined' ? ' · ' + t('res.st.quarantined') : ''), link: d.scanId ? 'results/' + d.scanId : null, group: 'threats' };
        case 'uninstall': return { ic: 'trash', cls: 'ok', title: t('h.uninstall', { name: d.name }), sub: d.threat || '', group: 'threats' };
        case 'update': return { ic: 'database', cls: 'info', title: t('h.update'), sub: t('h.updateDetail', { total: fmtNum(d.total), added: fmtNum(d.added) }) + (d.sources && d.sources.length ? ' · ' + d.sources.join(', ') : ''), group: 'updates' };
        case 'update-fail': return { ic: 'alert', cls: 'warn', title: t('h.updateFail'), sub: d.error || '', group: 'updates' };
        default: return { ic: 'info', cls: '', title: e.type, sub: '', group: 'all' };
      }
    },
    histRow(e) {
      const m = this.histMeta(e);
      return `<div class="act ${m.link ? 'link' : ''}" ${m.link ? `data-link="${m.link}"` : ''}><div class="a-ico ${m.cls}">${I(m.ic, 16)}</div><div class="a-txt"><div class="a-title">${esc(m.title)}</div>${m.sub ? `<div class="a-sub">${esc(m.sub)}</div>` : ''}</div><div class="a-time">${fmtAgo(e.ts)}</div></div>`;
    },
    bindHistRows(root) { $$('[data-link]', root).forEach(r => r.onclick = () => this.go(r.dataset.link)); },
    async renderHistory() {
      const el = $('#v-history');
      const all = (await dt.core('listHistory')).filter(e => e.type !== 'scan-start');
      const f = this._hFilter || 'all';
      const list = all.filter(e => f === 'all' || this.histMeta(e).group === f);
      const locale = I18N.getLang() === 'tr' ? 'tr-TR' : 'en-US';
      let html = '', lastDay = '';
      for (const e of list.slice(0, 300)) {
        const d = new Date(e.ts), key = d.toDateString();
        if (key !== lastDay) {
          if (lastDay) html += '</div>';
          const today = new Date().toDateString(), yd = new Date(Date.now() - 86400000).toDateString();
          const label = key === today ? t('time.today') : key === yd ? t('time.yesterday') : d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
          html += `<div class="day-head">${esc(label)}</div><div class="card" style="padding:4px 14px">`;
          lastDay = key;
        }
        html += this.histRow(e).replace(/<div class="a-time">.*?<\/div>/, `<div class="a-time">${fmtTime(e.ts)}</div>`);
      }
      if (lastDay) html += '</div>';
      el.innerHTML = `
        <div class="page-head"><div><h1 class="page">${t('h.title')}</h1><p class="page-sub">${t('h.sub')}</p></div>
          <div style="display:flex;gap:10px;align-items:center"><div class="filters">${['all', 'scans', 'threats', 'updates'].map(k => `<button class="fchip ${f === k ? 'active' : ''}" data-f="${k}">${t('h.f.' + k)}</button>`).join('')}</div>${all.length ? `<button class="btn ghost sm" id="hClear">${I('trash', 14)}${t('h.clear')}</button>` : ''}</div></div>
        ${list.length ? html : `<div class="empty"><div data-mochi="hempty:sleepy:150"></div><h3>${t('h.empty')}</h3></div>`}`;
      this.place(el);
      $$('[data-f]', el).forEach(b => b.onclick = () => { this._hFilter = b.dataset.f; this.renderHistory(); });
      this.bindHistRows(el);
      const c = $('#hClear'); if (c) c.onclick = async () => { if (await this.confirm({ title: t('h.clear'), body: t('h.confirmClear'), ok: t('h.clear'), danger: true })) { await dt.core('clearHistory'); this.renderHistory(); } };
    },

    // ───────── drag & drop into the main window ─────────
    wireDrop() { /* desktop file-drop zone replaced by the notch drag on Android */ },

    // ───────── modal / snack ─────────
    confirm({ title, body, ok, danger, wide, html }) {
      return new Promise((res) => {
        const box = $('#modalBox');
        box.className = 'm-box' + (wide ? ' wide' : '');
        box.innerHTML = `<h3>${esc(title)}</h3>${html ? body : `<p>${esc(body)}</p>`}<div class="m-actions">${ok === null ? '' : `<button class="btn ghost" data-m="0">${t('common.cancel')}</button>`}<button class="btn ${danger ? 'danger' : 'primary'}" data-m="1">${esc(ok || t('common.ok'))}</button></div>`;
        $('#modal').classList.add('show');
        this._modalRes = res;
        $$('[data-m]', box).forEach(b => b.onclick = () => this.closeModal(b.dataset.m === '1'));
      });
    },
    sheet(html, onOpen) {
      $('#sheetBox').innerHTML = `<div class="sh-grip"></div>${html}`;
      $('#sheet').classList.add('show');
      $('#sheet').onclick = (e) => { if (e.target.id === 'sheet') this.closeSheet(); };
      if (onOpen) onOpen($('#sheetBox'));
    },
    closeSheet() { $('#sheet').classList.remove('show'); },
    closeModal(v) { $('#modal').classList.remove('show'); if (this._modalRes) { this._modalRes(v); this._modalRes = null; } },
    showEula() {
      const txt = (EULA[I18N.getLang()] || EULA.tr).replace(/\{app\}/g, this.info.product.name);
      return this.confirm({ title: t('s.about.eula'), body: `<div class="eula-box card" style="padding:16px 18px;max-height:380px">${esc(txt)}</div>`, html: true, ok: t('common.close'), wide: true }).then(() => {});
    },
    snack(text, err) {
      const s = $('#snack');
      s.className = err ? 'err' : '';
      s.innerHTML = `${I(err ? 'alert' : 'check', 17)}<span>${esc(text)}</span>`;
      requestAnimationFrame(() => s.classList.add('show'));
      clearTimeout(this._snT); this._snT = setTimeout(() => s.classList.remove('show'), 3200);
    },
  };

  window.addEventListener('DOMContentLoaded', () => App.init());
})();
