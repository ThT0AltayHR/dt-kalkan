/* Installed apps grid — real icons and names from PackageManager. Long-press an app and drag it into the notch. */
(function () {
  'use strict';
  const { t, $, $$, esc, Sound, fmtBytes, fmtDate } = UI;
  const I = (n, s) => Icons.icon(n, s);
  const Apps = window.Apps = {
    list: null, icons: {}, system: false, q: '', loading: false,
    async ensureIcons(pkgs) {
      const need = [...new Set(pkgs)].filter(p => !(p in this.icons));
      for (let i = 0; i < need.length; i += 24) {
        try { Object.assign(this.icons, await dt.core('appIcons', need.slice(i, i + 24))); } catch { }
      }
    },
    async load(force) {
      if (this.loading) return;
      if (this.list && !force && this._sys === this.system) return;
      this.loading = true;
      try { this.list = await dt.core('listApps', this.system); this._sys = this.system; } catch { this.list = []; }
      this.loading = false;
      await this.ensureIcons(this.list.slice(0, 48).map(a => a.pkg));
      if (App.view === 'apps') this.fill();
      this.ensureIcons(this.list.map(a => a.pkg)).then(() => { if (App.view === 'apps') this.fill(true); });
    },
    render() {
      const el = $('#v-apps');
      el.innerHTML = `
        <div class="page-head"><div><h1 class="page">${t('apps.title')}</h1><p class="page-sub">${t('apps.sub')}</p></div></div>
        <div class="apps-bar">
          <div class="search">${I('search', 16)}<input id="appQ" placeholder="${t('apps.search')}" value="${esc(this.q)}"></div>
          <div class="seg" id="appSeg"><button data-s="0" class="${!this.system ? 'active' : ''}">${t('apps.user')}</button><button data-s="1" class="${this.system ? 'active' : ''}">${t('apps.system')}</button></div>
        </div>
        <div class="apps-meta"><span class="dim" id="appCount"></span><button class="btn sm primary" id="appScanAll">${I('zap', 14)}${t('apps.scanAll')}</button></div>
        <div class="app-grid" id="appGrid"><div class="empty" style="grid-column:1/-1;padding:40px 0"><span class="dim">…</span></div></div>
        <div class="apps-hint">${I('grip', 14)}${t('apps.hint')}</div>`;
      $('#appQ').oninput = (e) => { this.q = e.target.value; this.fill(); };
      $$('#appSeg [data-s]').forEach(b => b.onclick = () => { this.system = b.dataset.s === '1'; $$('#appSeg button').forEach(x => x.classList.toggle('active', x === b)); this.load(true); });
      $('#appScanAll').onclick = () => {
        const pk = (this.filtered || []).map(a => 'app://' + a.pkg);
        if (!pk.length) return;
        dt.core('startScan', { type: 'custom', paths: pk }).then(r => { if (r && r.error === 'BUSY') App.snack(t('scan.busy'), true); App.go('scan', true); });
        Sound.play('search');
      };
      if (this.list) this.fill(); else this.load();
      if (!this.list || Date.now() - (this._at || 0) > 30000) { this._at = Date.now(); this.load(true); }
    },
    fill(iconsOnly) {
      const grid = $('#appGrid'); if (!grid || !this.list) return;
      const q = this.q.trim().toLocaleLowerCase('tr');
      const list = this.filtered = this.list.filter(a => !q || a.name.toLocaleLowerCase('tr').includes(q) || a.pkg.includes(q));
      $('#appCount').textContent = t('apps.count', { n: list.length });
      if (iconsOnly) { $$('.app-tile img[data-pkg]', grid).forEach(img => { const s = this.icons[img.dataset.pkg]; if (s && img.getAttribute('src') !== s) img.src = s; }); return; }
      if (!list.length) { grid.innerHTML = `<div class="empty" style="grid-column:1/-1;padding:40px 0"><span class="dim">${t('apps.empty')}</span></div>`; return; }
      grid.innerHTML = list.map((a, i) => {
        const v = a.lastVerdict;
        const badge = v === 'malicious' ? `<span class="ab bad">${I('bug', 11)}</span>` : v === 'suspicious' ? `<span class="ab warn">!</span>` : v === 'clean' ? `<span class="ab ok">${I('check', 11)}</span>` : '';
        return `<div class="app-tile ${v || ''}" data-i="${i}"><div class="ai">${this.icons[a.pkg] ? `<img data-pkg="${esc(a.pkg)}" src="${this.icons[a.pkg]}" alt="">` : `<img data-pkg="${esc(a.pkg)}" alt="">`}${badge}</div><div class="an">${esc(a.name)}</div></div>`;
      }).join('');
      $$('.app-tile', grid).forEach(tile => {
        const a = list[+tile.dataset.i];
        tile.onclick = () => { if (tile._dragged) return; this.sheet(a); };
        InAppNotch.draggable(tile, () => ({ paths: ['app://' + a.pkg], name: a.name, icon: this.icons[a.pkg], anchor: tile.querySelector('.ai'), app: a }));
      });
    },
    sheet(a) {
      const v = a.lastVerdict;
      const vs = v ? `<span class="vpill ${v}">${t('verdict.' + v)}</span>${a.lastThreat ? ` <span class="tname">${esc(a.lastThreat)}</span>` : ''}` : `<span class="dim">${t('apps.never')}</span>`;
      const src = a.installer ? (/vending|appmarket|samsungapps|xiaomi|fdroid|amazon/.test(a.installer) ? t('apps.store') : a.installer) : (a.system ? 'Android' : t('apps.sideload'));
      App.sheet(`
        <div class="as-head"><img src="${this.icons[a.pkg] || ''}" alt=""><div style="min-width:0"><h3>${esc(a.name)}</h3><div class="dim mono" style="font-size:11.5px;overflow:hidden;text-overflow:ellipsis">${esc(a.pkg)}</div><div style="margin-top:6px">${vs}</div></div></div>
        <div class="as-kv">
          <div><span>${t('apps.version', { v: '' }).trim()}</span><b>${esc(a.version || '—')}</b></div>
          <div><span>${t('apps.size')}</span><b>${fmtBytes(a.size)}${a.splits > 1 ? ' · ' + t('apps.splits', { n: a.splits }) : ''}</b></div>
          <div><span>${t('apps.installer')}</span><b>${esc(src)}</b></div>
          <div><span>${t('apps.installed')}</span><b>${a.installedAt ? fmtDate(a.installedAt, false) : '—'}</b></div>
          <div><span>${t('res.perms')}</span><b>${t('apps.perms', { n: a.perms })}</b></div>
        </div>
        <div class="as-acts"><button class="btn primary" data-a="scan">${I('zap', 16)}${t('apps.scan')}</button><button class="btn" data-a="info">${I('info', 16)}${t('apps.details')}</button>${a.system ? '' : `<button class="btn danger" data-a="uninstall">${I('trash', 16)}${t('apps.uninstall')}</button>`}</div>`, (box) => {
        box.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
          const act = b.dataset.a; App.closeSheet();
          if (act === 'info') dt.ui('appDetails', { pkg: a.pkg });
          if (act === 'uninstall') dt.ui('uninstall', { pkg: a.pkg });
          if (act === 'scan') {
            const tile = $$('.app-tile').find(x => this.filtered[+x.dataset.i] === a);
            const r = tile ? tile.querySelector('.ai').getBoundingClientRect() : { left: innerWidth / 2 - 24, top: innerHeight / 2, width: 48, height: 48 };
            setTimeout(() => InAppNotch.drop(['app://' + a.pkg], r.left + r.width / 2, r.top + r.height / 2, { icon: this.icons[a.pkg], name: a.name, back: { x: r.left + r.width / 2, y: r.top + r.height / 2 } }), 250);
          }
        });
      });
    },
  };
  dt.on('notch:finished', () => { if (App.view === 'apps') Apps.load(true); });
  dt.on('realtime', (e) => { if (e && e.app && App.view === 'apps') Apps.load(true); });
})();
