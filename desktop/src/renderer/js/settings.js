/* Settings — modular categories in a left sidebar */
(function () {
  'use strict';
  const { t, $, $$, esc, Sound, fmtBytes, fmtNum, fmtDate, fmtIn, fmtAgo } = UI;
  const I = (n, s) => Icons.icon(n, s);
  const CATS = [['general', 'sliders'], ['protection', 'shield'], ['scan', 'scan'], ['notch', 'notch'], ['notifications', 'bell'], ['sound', 'volume'], ['appearance', 'palette'], ['quarantine', 'box'], ['updates', 'refresh'], ['about', 'info']];
  const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const patchOf = (p, v) => p.split('.').reverse().reduce((acc, k) => ({ [k]: acc }), v);

  const Settings = window.Settings = {
    cat: 'general',
    render(cat) {
      if (cat) this.cat = cat;
      const el = $('#v-settings');
      el.innerHTML = `<div class="page-head"><div><h1 class="page">${t('s.title')}</h1></div></div>
        <div class="settings"><div class="s-nav">${CATS.map(([k, ic]) => `<button data-cat="${k}" class="${k === this.cat ? 'active' : ''}">${I(ic, 17)}<span>${t('s.cat.' + k)}</span></button>`).join('')}</div><div id="sPanel"></div></div>`;
      $$('[data-cat]', el).forEach(b => b.onclick = () => { this.cat = b.dataset.cat; $$('[data-cat]', el).forEach(x => x.classList.toggle('active', x === b)); this.panel(); });
      this.panel();
    },
    onState(st) {
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' && a.type !== 'checkbox' && a.type !== 'range')) return;
      if (this._dragging) return;
      this.panel(true);
    },
    s() { return App.state.settings; },
    set(path, value) {
      // optimistic local update
      const parts = path.split('.'); let o = App.state.settings;
      for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
      o[parts[parts.length - 1]] = value;
      return dt.core('setSettings', patchOf(path, value));
    },
    // ── controls ──
    row(label, desc, control, extra = '') { return `<div class="s-row ${extra}"><div class="s-txt"><div class="s-l">${label}</div>${desc ? `<div class="s-d">${desc}</div>` : ''}</div>${control}</div>`; },
    toggle(path) { return `<label class="toggle"><input type="checkbox" data-tg="${path}" ${get(this.s(), path) ? 'checked' : ''}><span></span></label>`; },
    seg(path, opts) { const v = get(this.s(), path); return `<div class="seg" data-seg="${path}">${opts.map(([val, lab]) => `<button data-v="${val}" class="${String(v) === String(val) ? 'active' : ''}">${lab}</button>`).join('')}</div>`; },
    select(path, opts) { const v = get(this.s(), path); return `<select class="select" data-sel="${path}">${opts.map(([val, lab]) => `<option value="${val}" ${String(v) === String(val) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`; },
    range(path, min, max, step, fmt) { const v = get(this.s(), path); const p = ((v - min) / (max - min)) * 100; return `<div class="range"><input type="range" data-rg="${path}" min="${min}" max="${max}" step="${step}" value="${v}" style="--p:${p}%" data-fmt="${fmt || ''}"><output>${this.fmtRange(v, fmt)}</output></div>`; },
    fmtRange(v, fmt) { return fmt === 'pct' ? Math.round(v * 100) + '%' : fmt === 's' ? v + ' sn' : fmt === 'mb' ? v + ' MB' : String(v); },
    group(title, rows) { return (title ? `<div class="s-group-title">${title}</div>` : '') + `<div class="s-group">${rows.join('')}</div>`; },

    panel(keepScroll) {
      const box = $('#sPanel'); if (!box) return;
      const sc = $('#v-settings').scrollTop;
      const fn = this['p_' + this.cat];
      box.innerHTML = `<div class="s-panel" ${keepScroll ? 'style="animation:none"' : ''}><h2>${t('s.cat.' + this.cat)}</h2>${fn.call(this)}</div>`;
      this.bind(box);
      if (keepScroll) $('#v-settings').scrollTop = sc;
      if (this['after_' + this.cat]) this['after_' + this.cat](box);
    },
    bind(box) {
      $$('[data-tg]', box).forEach(i => i.onchange = async () => { Sound.play('pop', { gain: .5 }); await this.set(i.dataset.tg, i.checked); });
      $$('[data-seg]', box).forEach(sg => $$('button', sg).forEach(b => b.onclick = async () => {
        $$('button', sg).forEach(x => x.classList.toggle('active', x === b));
        let v = b.dataset.v; if (/^-?\d+(\.\d+)?$/.test(v)) v = +v;
        Sound.play('hover', { gain: .6 });
        await this.set(sg.dataset.seg, v);
      }));
      $$('[data-sel]', box).forEach(s => s.onchange = () => { let v = s.value; if (/^-?\d+$/.test(v)) v = +v; this.set(s.dataset.sel, v); });
      $$('[data-rg]', box).forEach(r => {
        const out = r.nextElementSibling;
        r.oninput = () => { this._dragging = true; const p = ((r.value - r.min) / (r.max - r.min)) * 100; r.style.setProperty('--p', p + '%'); out.textContent = this.fmtRange(+r.value, r.dataset.fmt); };
        r.onchange = async () => { this._dragging = false; await this.set(r.dataset.rg, +r.value); if (r.dataset.rg === 'sound.volume') { Sound.set(App.state.settings.sound); Sound.play('pop'); } };
      });
      $$('[data-act]', box).forEach(b => b.onclick = () => this.action(b.dataset.act, b));
    },

    // ── categories ──
    p_general() {
      const s = this.s();
      return this.group(null, [
        this.row(t('s.general.lang'), t('s.general.langSub'), this.seg('lang', [['tr', 'Türkçe'], ['en', 'English']])),
        this.row(t('s.general.startup'), t('s.general.startupSub'), this.toggle('general.startup')),
        this.row(t('s.general.tray'), t('s.general.traySub'), this.toggle('general.closeToTray')),
        this.row(t('s.general.minimized'), t('s.general.minimizedSub'), this.toggle('general.startMinimized'), s.general.startup ? '' : 'disabled'),
      ]) + this.group('', [
        this.row(t('s.general.onboarding'), t('s.general.onboardingSub'), `<button class="btn sm" data-act="onboarding">${t('s.general.onboardingBtn')}</button>`),
        this.row(t('s.general.reset'), t('s.general.resetSub'), `<button class="btn sm danger" data-act="reset">${t('s.general.resetBtn')}</button>`),
      ]);
    },
    p_protection() {
      const s = this.s();
      const folders = s.protection.folders || [];
      const exts = ['exe', 'dll', 'scr', 'com', 'pif', 'msi', 'bat', 'cmd', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'hta', 'lnk', 'zip', 'jar', 'docm', 'xlsm', 'doc', 'xls', 'iso', 'img', 'py', 'reg', 'pdf', 'rtf'];
      const on = new Set(s.protection.watchExtensions);
      return this.group(null, [
        this.row(t('s.protection.realtime'), t('s.protection.realtimeSub'), this.toggle('protection.realtime')),
        this.row(t('s.protection.auto'), t('s.protection.autoSub'), this.toggle('protection.autoQuarantine')),
        this.row(t('s.protection.default'), t('s.protection.defaultSub'), this.toggle('protection.defaultFolders'), s.protection.realtime ? '' : 'disabled'),
      ]) + this.group('', [
        `<div class="s-row col ${s.protection.realtime ? '' : 'disabled'}"><div style="display:flex;align-items:center;gap:18px"><div class="s-txt"><div class="s-l">${t('s.protection.folders')}</div><div class="s-d">${t('s.protection.foldersSub')}</div></div><button class="btn sm" data-act="addWatch">${I('plus', 14)}${t('s.protection.addFolder')}</button></div>
          <div class="paths">${folders.length ? folders.map((f, i) => `<div class="path-item">${I('folder', 15)}<span title="${esc(f)}">${esc(f)}</span><button class="icon-btn" data-act="rmWatch" data-i="${i}">${I('x', 14)}</button></div>`).join('') : `<div class="dim" style="font-size:12.5px">${t('s.protection.none')}</div>`}</div></div>`,
        `<div class="s-row col"><div class="s-txt"><div class="s-l">${t('s.protection.ext')}</div><div class="s-d">${t('s.protection.extSub')}</div></div><div class="ext-chips">${exts.map(e => `<span class="chip ${on.has(e) ? 'on' : ''}" data-act="ext" data-e="${e}">.${e}</span>`).join('')}</div></div>`,
      ]);
    },
    p_scan() {
      const s = this.s(), sc = s.scan.schedule, en = sc.enabled;
      const freq = sc.frequency;
      const rows = [
        this.row(t('s.scan.schedule'), en ? t('s.scan.next', { t: fmtIn(App.state.nextScheduled) }) : t('s.scan.scheduleSub'), this.toggle('scan.schedule.enabled')),
        this.row(t('s.scan.freq'), '', this.seg('scan.schedule.frequency', ['hourly', 'daily', 'weekly', 'custom'].map(k => [k, t('s.scan.freq.' + k)])), en ? '' : 'disabled'),
      ];
      if (freq === 'daily' || freq === 'weekly') rows.push(this.row(t('s.scan.time'), '', this.select('scan.schedule.time', Array.from({ length: 48 }, (_, i) => { const v = String(Math.floor(i / 2)).padStart(2, '0') + ':' + (i % 2 ? '30' : '00'); return [v, v]; }).concat(/^\d\d:\d\d$/.test(sc.time) && !/:(00|30)$/.test(sc.time) ? [[sc.time, sc.time]] : [])), en ? '' : 'disabled'));
      if (freq === 'weekly') rows.push(this.row(t('s.scan.weekday'), '', this.select('scan.schedule.weekday', [1, 2, 3, 4, 5, 6, 0].map(d => [d, t('weekday.' + d)])), en ? '' : 'disabled'));
      if (freq === 'custom') rows.push(this.row(t('s.scan.every', { n: sc.customHours }), t('s.scan.everySub'), this.range('scan.schedule.customHours', 1, 72, 1), en ? '' : 'disabled'));
      rows.push(this.row(t('s.scan.type'), '', this.seg('scan.schedule.type', [['quick', t('scan.quick')], ['full', t('scan.full')]]), en ? '' : 'disabled'));
      const excl = s.scan.exclusions || [];
      return this.group(null, rows) + this.group('', [
        this.row(t('s.scan.files'), t('s.scan.filesSub'), this.seg('scan.fileTypes', [['smart', t('s.scan.files.smart')], ['all', t('s.scan.files.all')]])),
        this.row(t('s.scan.depth'), t('s.scan.depthSub'), this.range('scan.archiveDepth', 0, 5, 1)),
        this.row(t('s.scan.heur'), t('s.scan.heurSub'), this.seg('scan.heuristics', ['low', 'normal', 'high'].map(k => [k, t('s.scan.heur.' + k)])), s.scan.heuristicsEnabled === false ? 'disabled' : ''),
        this.row(t('s.scan.large'), t('s.scan.largeSub'), this.toggle('scan.skipLarge')),
        this.row(t('s.scan.limit'), '', this.range('scan.maxFileMB', 8, 256, 8, 'mb'), s.scan.skipLarge ? '' : 'disabled'),
      ]) + this.group('', [
        `<div class="s-row col"><div style="display:flex;align-items:center;gap:18px"><div class="s-txt"><div class="s-l">${t('s.scan.excl')}</div><div class="s-d">${t('s.scan.exclSub')}</div></div><button class="btn sm" data-act="addExcl">${I('plus', 14)}${t('s.scan.addExcl')}</button></div>
          <div class="paths">${excl.length ? excl.map((f, i) => `<div class="path-item">${I('folder', 15)}<span title="${esc(f)}">${esc(f)}</span><button class="icon-btn" data-act="rmExcl" data-i="${i}">${I('x', 14)}</button></div>`).join('') : `<div class="dim" style="font-size:12.5px">—</div>`}</div></div>`,
      ]);
    },
    after_scan(box) {
      $$('[data-time]', box).forEach(i => i.onchange = () => { if (/^\d{2}:\d{2}$/.test(i.value)) this.set(i.dataset.time, i.value); });
      // frequency change needs the dependent rows
      $$('[data-seg="scan.schedule.frequency"] button', box).forEach(b => { const o = b.onclick; b.onclick = async () => { await o(); this.panel(true); }; });
      $$('[data-tg="scan.skipLarge"],[data-tg="scan.schedule.enabled"]', box).forEach(i => { const o = i.onchange; i.onchange = async () => { await o(); this.panel(true); }; });
    },
    p_notch() {
      const s = this.s(), en = s.notch.enabled, d = en ? '' : 'disabled';
      const w = this._weather;
      return this.group(null, [
        this.row(t('s.notch.enable'), t('s.notch.enableSub'), this.toggle('notch.enabled')),
        this.row(t('s.notch.style'), '', this.seg('notch.style', [['notch', t('s.notch.style.notch')], ['island', t('s.notch.style.island')]]), d),
        this.row(t('s.notch.pos'), '', this.seg('notch.position', ['left', 'center', 'right'].map(k => [k, t('s.notch.pos.' + k)])), d),
        this.row(t('s.notch.hover'), t('s.notch.hoverSub'), this.toggle('notch.hoverExpand'), d),
        this.row(t('s.notch.progress'), t('s.notch.progressSub'), this.toggle('notch.showProgress'), d),
        this.row(t('s.notch.clock24'), '', this.toggle('notch.clock24'), d),
      ]) + this.group('', [
        this.row(t('s.notch.weather'), t('s.notch.weatherSub'), this.toggle('notch.weather'), d),
        this.row(t('s.notch.units'), '', this.seg('notch.units', [['c', '°C'], ['f', '°F']]), en && s.notch.weather ? '' : 'disabled'),
        this.row(t('s.notch.location'), `<span id="wxLoc">${w ? `${Icons.weatherIcon(w.code, w.isDay, 15).replace('<svg', '<svg style="vertical-align:-3px;margin-right:5px"')}${esc(w.city || '')}${w.country ? ', ' + esc(w.country) : ''} · ${Math.round(w.temp)}°${w.unit === 'f' ? 'F' : 'C'}` : '—'}</span>`, `<button class="btn sm" data-act="wx">${I('refresh', 14)}${t('s.notch.refresh')}</button>`, en && s.notch.weather ? '' : 'disabled'),
      ]);
    },
    after_notch() { if (!this._weather && this.s().notch.weather) dt.core('getWeather').then(w => { if (w) { this._weather = w; if (this.cat === 'notch') this.panel(true); } }); },
    p_notifications() {
      const s = this.s(), d = s.notifications.enabled ? '' : 'disabled';
      return this.group(null, [
        this.row(t('s.notif.enable'), t('s.notif.enableSub'), this.toggle('notifications.enabled')),
        this.row(t('s.notif.threats'), '', this.toggle('notifications.threats'), d),
        this.row(t('s.notif.scanDone'), '', this.toggle('notifications.scanDone'), d),
        this.row(t('s.notif.quarantine'), '', this.toggle('notifications.quarantine'), d),
        this.row(t('s.notif.updates'), '', this.toggle('notifications.updates'), d),
        this.row(t('s.notif.duration'), '', this.range('notifications.duration', 3, 15, 1, 's'), d),
      ]) + this.group('', [this.row(t('s.notif.test'), '', `<button class="btn sm" data-act="testToast">${I('bell', 14)}${t('s.notif.testBtn')}</button>`, d)]);
    },
    p_sound() {
      const s = this.s(), d = s.sound.enabled ? '' : 'disabled';
      return this.group(null, [
        this.row(t('s.sound.enable'), t('s.sound.enableSub'), this.toggle('sound.enabled')),
        this.row(t('s.sound.volume'), '', this.range('sound.volume', 0, 1, 0.05, 'pct'), d),
        this.row(t('s.sound.pack'), '', this.seg('sound.pack', [['soft', t('s.sound.pack.soft')], ['minimal', t('s.sound.pack.minimal')]]), d),
      ]) + `<div class="s-group-title">${t('s.sound.events')}</div>` + this.group(null, ['threat', 'scan', 'notch', 'ui'].map(k => this.row(t('s.sound.ev.' + k), '', this.toggle('sound.events.' + k), d)))
        + this.group('', [this.row(t('s.sound.test'), '', `<div style="display:flex;gap:6px">${[['finish', 's.sound.t.clean'], ['alarm', 's.sound.t.alarm'], ['blip', 's.sound.t.notify'], ['open', 's.sound.t.open']].map(([n, k]) => `<button class="btn sm" data-act="snd" data-n="${n}">${I('play', 12)}${t(k)}</button>`).join('')}</div>`, d)]);
    },
    after_sound() { Sound.set(this.s().sound); },
    p_appearance() {
      const s = this.s();
      return this.group(null, [
        this.row(t('s.app.accent'), t('s.app.accentSub'), `<div class="swatches">${Object.entries(UI.ACCENTS).map(([k, c]) => `<div class="swatch ${s.appearance.accent === k ? 'active' : ''}" title="${t('s.app.accent.' + k)}" data-act="accent" data-k="${k}" style="background:linear-gradient(135deg,${c[0]},${c[1]})"></div>`).join('')}</div>`),
        this.row(t('s.app.animations'), t('s.app.animationsSub'), this.toggle('appearance.animations')),
      ]);
    },
    p_quarantine() {
      const s = this.s();
      const allow = s.allowlist || [];
      return this.group(null, [
        this.row(t('s.q.retention'), t('s.q.retentionSub'), this.seg('quarantine.retentionDays', [0, 7, 30, 90].map(k => [k, t('s.q.ret.' + k)]))),
      ]) + this.group('', [
        `<div class="s-row col"><div class="s-txt"><div class="s-l">${t('s.q.allow')}</div><div class="s-d">${t('s.q.allowSub')}</div></div>
          <div class="paths">${allow.length ? allow.map(h => `<div class="path-item">${I('check', 15)}<span>${esc(h)}</span><button class="icon-btn" data-act="rmAllow" data-h="${h}">${I('x', 14)}</button></div>`).join('') : `<div class="dim" style="font-size:12.5px">${t('s.q.allowNone')}</div>`}</div></div>`,
      ]);
    },
    p_updates() {
      const s = this.s(), sig = App.state.sig, u = s.updates;
      const lr = u.lastResult;
      const updating = App.state.updating || this._upd;
      return `<div class="card db-card" style="margin-bottom:14px"><div class="db-ico">${I('database', 22)}</div><div style="flex:1;min-width:0"><div class="s-l" style="font-weight:600">${t('s.u.db')}</div>
          <div class="s-d dim" style="font-size:12.5px;margin-top:3px">${t('s.u.dbSub', { n: fmtNum(sig.total), size: fmtBytes(sig.bytes), date: sig.created ? fmtDate(sig.created) : '—' })}</div>
          <div class="s-d dim" style="font-size:12.5px;margin-top:2px">${t('s.u.rulesSub', { n: sig.rules, v: sig.rulesVersion || '—' })}</div>
          <div id="updBox" style="margin-top:10px;${updating ? '' : 'display:none'}"><div class="progress"><i id="updBar" style="width:${Math.round((this._updP || 0.02) * 100)}%"></i></div><div class="dim" id="updTxt" style="font-size:12px;margin-top:6px">${esc(this._updT || t('s.u.stage.index'))}</div></div>
          <div class="dim" id="updLast" style="font-size:12px;margin-top:8px;${updating ? 'display:none' : ''}">${lr ? (lr.ok ? t('s.u.last', { t: fmtAgo(lr.at) }) : t('s.u.lastFail', { e: lr.error })) : ''}</div></div>
          <button class="btn primary" data-act="update" ${updating ? 'disabled' : ''}>${I('refresh', 16)}${updating ? t('s.u.updating') : t('s.u.now')}</button></div>`
        + this.group(null, [
          this.row(t('s.u.auto'), t('s.u.autoSub'), this.toggle('updates.auto')),
          this.row(t('s.u.freq'), '', this.seg('updates.frequency', ['hourly', 'daily', 'weekly'].map(k => [k, t('s.u.freq.' + k)])), u.auto ? '' : 'disabled'),
          this.row(t('s.u.key'), t('s.u.keySub'), `<input class="input" type="password" data-key="updates.mbAuthKey" placeholder="${t('s.u.keyPh')}" value="${esc(u.mbAuthKey || '')}" style="width:230px">`),
        ]);
    },
    after_updates(box) { $$('[data-key]', box).forEach(i => i.onchange = () => this.set(i.dataset.key, i.value.trim())); },
    onUpdateProgress(p) {
      this._upd = p.stage !== 'done' && p.stage !== 'error';
      this._updP = p.pct;
      this._updT = p.stage === 'download' ? t('s.u.stage.download', { d: p.done || 0, n: p.total || 30 }) : t('s.u.stage.' + (p.stage === 'error' ? 'done' : p.stage));
      if (App.view !== 'settings' || this.cat !== 'updates') return;
      if (!this._upd) { this.panel(true); return; }
      const bar = $('#updBar'); if (!bar) return this.panel(true);
      $('#updBox').style.display = ''; $('#updLast').style.display = 'none';
      bar.style.width = Math.round(p.pct * 100) + '%'; $('#updTxt').textContent = this._updT;
    },
    p_about() {
      const P = App.info.product;
      const si = this._sys;
      const eula = (EULA[I18N.getLang()] || EULA.tr).replace(/\{app\}/g, P.name);
      return `<div class="card about-hero"><img src="img/logo.svg" alt=""><div><h3>${esc(P.name)}</h3><div class="muted" style="margin-top:4px">${t('s.about.version', { v: P.version })} · ${t('s.about.build', { d: App.info.buildDate })} · ${t('s.about.licensed')}</div><div class="dim" style="margin-top:6px;font-size:12.5px">${esc(P.copyright)}</div></div></div>`
        + this.group('', [
          this.row(t('s.about.engine'), `${fmtNum(App.state.sig.total)} ${I18N.getLang() === 'tr' ? 'imza' : 'signatures'} · ${App.state.sig.rules} ${I18N.getLang() === 'tr' ? 'kural' : 'rules'} · PE · ZIP · VBA`, ''),
          this.row(t('s.about.system'), si ? `${esc(si.os)} · ${esc(si.arch)} · ${si.cpus} CPU · ${fmtBytes(si.mem)}` : '…', ''),
          this.row(t('s.about.elevated'), '', `<span class="chip ${si && si.elevated ? 'on' : ''}">${si ? (si.elevated ? t('common.yes') : t('common.no')) : '…'}</span>`),
          this.row(t('s.about.workers'), '', `<span class="chip">${si ? si.workers : '…'}</span>`),
          this.row(t('s.about.support'), esc(P.supportEmail), `<button class="btn sm" data-act="mail">${I('external', 13)}${t('common.open')}</button>`),
        ])
        + `<div class="s-group-title">${t('s.about.eula')}</div><div class="s-group"><div class="eula-box">${esc(eula)}</div></div>`
        + `<div class="dim" style="font-size:12px;margin:14px 4px">${t('s.about.credits')}</div>`;
    },
    after_about() { if (!this._sys) dt.core('systemInfo').then(s => { this._sys = s; if (this.cat === 'about') this.panel(true); }); },

    async action(a, el) {
      const s = this.s();
      switch (a) {
        case 'reset': if (await App.confirm({ title: t('s.general.reset'), body: t('s.general.confirmReset'), ok: t('s.general.resetBtn'), danger: true })) { App.state.settings = await dt.core('resetSettings'); this.panel(true); } break;
        case 'onboarding': Onboarding.start({ intro: true }); break;
        case 'addWatch': case 'addExcl': {
          const p = await dt.ui('pick', { folders: true }); if (!p || !p.length) return;
          const key = a === 'addWatch' ? 'protection.folders' : 'scan.exclusions';
          const cur = get(s, key) || [];
          await this.set(key, [...new Set(cur.concat(p))]); this.panel(true); break;
        }
        case 'rmWatch': case 'rmExcl': {
          const key = a === 'rmWatch' ? 'protection.folders' : 'scan.exclusions';
          const cur = (get(s, key) || []).slice(); cur.splice(+el.dataset.i, 1);
          await this.set(key, cur); this.panel(true); break;
        }
        case 'ext': {
          const e = el.dataset.e; const cur = new Set(s.protection.watchExtensions);
          cur.has(e) ? cur.delete(e) : cur.add(e);
          el.classList.toggle('on', cur.has(e));
          await this.set('protection.watchExtensions', [...cur]); break;
        }
        case 'wx': { el.disabled = true; const w = await dt.core('getWeather', true); this._weather = w; this.panel(true); break; }
        case 'testToast': dt.ui('toast:show', { kind: 'info', mood: 'happy', title: t('t.test'), body: t('t.testBody'), sound: 'blip', actions: [{ id: 'dismiss', label: t('t.dismiss') }] }); break;
        case 'snd': Sound.set(s.sound); Sound.play(el.dataset.n, { force: true }); break;
        case 'accent': $$('.swatch').forEach(x => x.classList.toggle('active', x === el)); await this.set('appearance.accent', el.dataset.k); UI.applyAppearance(App.state.settings); break;
        case 'rmAllow': await dt.core('removeAllow', el.dataset.h); App.state.settings.allowlist = s.allowlist.filter(x => x !== el.dataset.h); this.panel(true); break;
        case 'update': this._upd = true; this._updP = 0.02; this._updT = t('s.u.stage.index'); this.panel(true); dt.core('updateSignatures'); break;
        case 'mail': dt.ui('external', { url: 'mailto:' + App.info.product.supportEmail }); break;
      }
    },
  };
})();
