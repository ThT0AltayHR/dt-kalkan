'use strict';
// UI host: main window, dynamic notch, toast stack, tray. Talks to the protection core
// directly (single process) or through CoreProxy (split elevated/non-elevated mode).
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const PRODUCT = require('../config/product');
const I18N = require('../renderer/js/i18n');
const { Core } = require('./core');

const R = (...p) => path.join(__dirname, '..', ...p);
const ASSET = (...p) => path.join(__dirname, '..', '..', 'build', ...p);

const NOTCH_IDLE = { w: 360, h: 56 };

class UiHost {
  constructor(core, opts) {
    this.core = core; this.opts = opts;
    this.main = null; this.notch = null; this.toast = null; this.tray = null;
    this.settings = null;
    this.toastSeq = 0;
    I18N.setApp(PRODUCT.name);
  }
  t(k, v) { return I18N.t(k, v); }

  async start() {
    const st = await this.core.getState();
    this.settings = st.settings;
    I18N.setLang(this.settings.lang);
    this._wireIpc();
    this._wireCore();
    this._createTray();
    this._createToast();
    const onboarded = this.settings.onboarded;
    if (!this.opts.startHidden || !onboarded) this.showMain();
    if (onboarded) this._createNotch();
  }

  // ───────── windows ─────────
  _webPrefs(role) {
    return { preload: R('preload', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: role !== 'notch', additionalArguments: [`--dt-role=${role}`], spellcheck: false };
  }
  showMain(route) {
    if (this.main && !this.main.isDestroyed()) {
      if (this.main.isMinimized()) this.main.restore();
      this.main.show(); this.main.focus();
      if (route) this.send(this.main, 'navigate', route);
      return this.main;
    }
    const wa = screen.getPrimaryDisplay().workAreaSize;
    const w = Math.min(1220, wa.width - 60), h = Math.min(800, wa.height - 60);
    this.main = new BrowserWindow({
      width: w, height: h, minWidth: 1020, minHeight: 660, frame: false, show: false, backgroundColor: '#0B0D12', title: PRODUCT.name,
      icon: ASSET('icon.png'), webPreferences: this._webPrefs('main'), roundedCorners: true, thickFrame: true,
    });
    this.main.loadFile(R('renderer', 'main.html'), { query: route ? { route } : {} });
    this.main.once('ready-to-show', () => { if (!this._hiddenStart) this.main.show(); });
    this.main.on('maximize', () => this.send(this.main, 'win', { maximized: true }));
    this.main.on('unmaximize', () => this.send(this.main, 'win', { maximized: false }));
    this.main.on('close', (e) => {
      if (this._quitting) return;
      if (this.settings.general.closeToTray && this.settings.onboarded) {
        e.preventDefault(); this.main.hide();
        if (!this.settings.general.trayHintShown) {
          this.toastShow({ kind: 'info', mood: 'sleepy', title: this.t('t.tray'), body: this.t('t.trayBody') });
          this.core.setSettings({ general: { trayHintShown: true } });
        }
      } else if (!this.settings.onboarded) { this.quit(); }
    });
    this.main.on('closed', () => { this.main = null; });
    this.main.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    return this.main;
  }
  _notchBounds(w, h) {
    const d = screen.getPrimaryDisplay();
    const b = d.bounds;
    const pos = (this.settings.notch && this.settings.notch.position) || 'center';
    const cx = pos === 'left' ? b.x + b.width * 0.22 : pos === 'right' ? b.x + b.width * 0.78 : b.x + b.width / 2;
    const top = this.settings.notch.style === 'island' ? b.y + 8 : b.y;
    return { x: Math.round(cx - w / 2), y: top, width: Math.round(w), height: Math.round(h) };
  }
  _createNotch() {
    if (!this.settings.notch.enabled || (this.notch && !this.notch.isDestroyed())) return;
    this.notch = new BrowserWindow({
      ...this._notchBounds(NOTCH_IDLE.w, NOTCH_IDLE.h), frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, focusable: true, show: false, backgroundColor: '#00000000',
      webPreferences: this._webPrefs('notch'), title: PRODUCT.name + ' Notch',
    });
    this.notch.setAlwaysOnTop(true, 'screen-saver');
    this.notch.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.notch.loadFile(R('renderer', 'notch.html'));
    this.notch.once('ready-to-show', () => this.notch && this.notch.showInactive());
    this.notch.on('closed', () => { this.notch = null; });
    screen.on('display-metrics-changed', () => this._repositionNotch());
  }
  _destroyNotch() { if (this.notch && !this.notch.isDestroyed()) this.notch.destroy(); this.notch = null; }
  _repositionNotch() {
    if (!this.notch || this.notch.isDestroyed()) return;
    const [w, h] = this.notch.getSize();
    this.notch.setBounds(this._notchBounds(w, h));
  }
  _createToast() {
    const wa = screen.getPrimaryDisplay().workArea;
    const W = 404;
    this.toast = new BrowserWindow({
      x: wa.x + wa.width - W - 6, y: wa.y + 6, width: W, height: Math.min(720, wa.height - 12), frame: false, transparent: true, resizable: false, movable: false,
      skipTaskbar: true, alwaysOnTop: true, hasShadow: false, focusable: false, show: false, backgroundColor: '#00000000', webPreferences: this._webPrefs('toast'),
    });
    this.toast.setAlwaysOnTop(true, 'pop-up-menu');
    this.toast.setIgnoreMouseEvents(true, { forward: true });
    this.toast.loadFile(R('renderer', 'toast.html'));
    this.toast.on('closed', () => { this.toast = null; });
    this._toastReady = new Promise(r => this.toast.webContents.once('did-finish-load', r));
  }
  async toastShow(t) {
    const s = this.settings.notifications;
    if (!s.enabled && !t.force) return;
    if (!this.toast || this.toast.isDestroyed()) this._createToast();
    await this._toastReady;
    t.id = ++this.toastSeq; t.duration = t.duration || s.duration * 1000;
    if (!this.toast.isVisible()) this.toast.showInactive();
    this.send(this.toast, 'toast', t);
  }
  send(win, name, data) { if (win && !win.isDestroyed()) win.webContents.send('evt', name, data); }
  broadcast(name, data) { for (const w of [this.main, this.notch, this.toast]) this.send(w, name, data); }

  // ───────── tray ─────────
  _trayIcon(kind) {
    const f = ASSET(kind === 'scan' ? 'tray-scan.png' : kind === 'alert' ? 'tray-alert.png' : 'tray.png');
    let img = nativeImage.createFromPath(fs.existsSync(f) ? f : ASSET('tray.png'));
    if (process.platform !== 'win32' && !img.isEmpty()) img = img.resize({ width: 22, height: 22 });
    return img;
  }
  _createTray() {
    try {
      this.tray = new Tray(this._trayIcon());
      this.tray.setToolTip(this.t('tray.tip'));
      this.tray.on('click', () => this.showMain());
      this.tray.on('double-click', () => this.showMain());
      this._updateTrayMenu();
    } catch (e) { /* tray unsupported */ }
  }
  _updateTrayMenu() {
    if (!this.tray) return;
    const s = this.settings;
    const m = Menu.buildFromTemplate([
      { label: this.t('tray.open'), click: () => this.showMain() },
      { type: 'separator' },
      { label: this.t('tray.quick'), click: () => { this.core.startScan({ type: 'quick' }); this.showMain('scan'); } },
      { label: this.t('tray.update'), click: () => this.core.updateSignatures() },
      { type: 'separator' },
      { label: this.t('tray.realtime'), type: 'checkbox', checked: !!s.protection.realtime, click: (i) => this.core.setSettings({ protection: { realtime: i.checked } }) },
      { label: this.t('tray.notch'), type: 'checkbox', checked: !!s.notch.enabled, enabled: !!s.onboarded, click: (i) => this.core.setSettings({ notch: { enabled: i.checked } }) },
      { type: 'separator' },
      { label: this.t('tray.quit'), click: () => this.quit() },
    ]);
    this.tray.setContextMenu(m);
  }
  quit() {
    this._quitting = true;
    try { this.tray && this.tray.destroy(); } catch { }
    for (const w of BrowserWindow.getAllWindows()) try { w.destroy(); } catch { }
    this.opts.onQuit ? this.opts.onQuit() : app.exit(0);
  }

  // ───────── core events → UI ─────────
  _wireCore() {
    const c = this.core;
    for (const ev of Core.EVENTS) c.on(ev, (d) => this.broadcast(ev, d));
    c.on('state', (st) => this._applySettings(st.settings));
    c.on('scan:progress', (p) => { if (this.tray) this.tray.setToolTip(this.t('tray.tipScan', { p: Math.round(p.percent * 100) })); });
    c.on('scan:start', () => { if (this.tray) this.tray.setImage(this._trayIcon('scan')); this._scanAlerted = false; });
    c.on('scan:threat', ({ item, scanId }) => {
      // a big scan found something → one notch alert per scan
      if (!this._scanAlerted && scanId && scanId[0] === 'S') { this._scanAlerted = true; this.send(this.notch, 'notch:alert', { item, scanId, source: 'scan' }); }
    });
    c.on('scan:done', (sum) => {
      if (this.tray) { this.tray.setImage(this._trayIcon(sum.threats ? 'alert' : null)); this.tray.setToolTip(this.t('tray.tip')); }
      if (this.settings.notifications.scanDone) {
        const clean = !sum.threats;
        this.toastShow({ kind: clean ? 'success' : 'danger', mood: clean ? 'clean' : 'alarmed', title: this.t('t.scanDone'),
          body: clean ? this.t('t.scanDoneClean', { n: sum.scanned.toLocaleString() }) : this.t('t.scanDoneThreats', { n: sum.scanned.toLocaleString(), t: sum.threats }),
          actions: [{ id: 'open-results', label: this.t('t.view'), primary: true }], data: { scanId: sum.id }, sound: clean ? 'clean' : 'alarm' });
      }
    });
    c.on('threat', (ev) => {
      const it = ev.item;
      this.send(this.notch, 'notch:alert', ev);
      if (this.settings.notifications.threats) {
        const q = ev.action === 'quarantined';
        this.toastShow({ kind: it.verdict === 'malicious' ? 'danger' : 'warn', mood: q ? 'angry' : 'worried', title: it.verdict === 'malicious' ? this.t('t.threat') : this.t('t.suspicious'),
          body: q ? this.t('t.threatQ', { name: it.name, threat: it.threat }) : this.t('t.threatBody', { name: it.name, threat: it.threat }),
          actions: q ? [{ id: 'open-results', label: this.t('t.view'), primary: true }] : [{ id: 'quarantine', label: this.t('t.quarantineAct'), primary: true }, { id: 'open-results', label: this.t('t.view') }],
          data: { scanId: ev.scanId, path: it.path }, sound: this.notch ? 'blip' : 'alarm', duration: 12000 });
      }
    });
    c.on('quarantine', (ev) => {
      if (!this.settings.notifications.quarantine || !ev.item) return;
      if (ev.type === 'add' && ev.item.source !== 'realtime') this.toastShow({ kind: 'success', mood: 'proud', title: this.t('t.quarantine'), body: this.t('t.quarantineBody', { name: ev.item.name }), actions: [{ id: 'open-quarantine', label: this.t('t.view') }], sound: 'pop' });
      if (ev.type === 'restore') this.toastShow({ kind: 'info', mood: 'happy', title: this.t('t.restore'), body: this.t('t.restoreBody', { name: ev.item.name }), sound: 'pop' });
    });
    c.on('update:done', (r) => {
      if (!this.settings.notifications.updates) return;
      if (r.ok) this.toastShow({ kind: 'info', mood: 'cool', title: this.t('t.dbUpdated'), body: this.t('t.dbUpdatedBody', { total: r.total.toLocaleString(), added: r.added.toLocaleString() }), sound: 'blip' });
      else this.toastShow({ kind: 'warn', mood: 'worried', title: this.t('t.dbFail'), body: this.t('t.dbFailBody'), sound: 'blip' });
    });
  }
  _applySettings(s) {
    const prev = this.settings;
    this.settings = s;
    I18N.setLang(s.lang);
    this._updateTrayMenu();
    if (!s.onboarded) return;
    if (s.notch.enabled && !this.notch) this._createNotch();
    else if (!s.notch.enabled && this.notch) this._destroyNotch();
    else if (this.notch && prev && (prev.notch.position !== s.notch.position || prev.notch.style !== s.notch.style)) this._repositionNotch();
  }

  // ───────── IPC ─────────
  _wireIpc() {
    const allowed = new Set(Core.RPC_METHODS);
    ipcMain.handle('core', async (e, method, args) => {
      if (!allowed.has(method)) throw new Error('FORBIDDEN');
      return this.core[method](...(args || []));
    });
    ipcMain.handle('ui', async (e, action, p) => this._ui(e, action, p));
    ipcMain.on('ui-sync', (e, action, p) => { this._ui(e, action, p); e.returnValue = true; });
    ipcMain.on('drag-start', (e, filePath) => {
      try { if (filePath && fs.existsSync(filePath)) e.sender.startDrag({ file: filePath, icon: nativeImage.createFromPath(ASSET('drag.png')) }); } catch { }
    });
  }
  async _ui(e, action, p) {
    const win = BrowserWindow.fromWebContents(e.sender);
    switch (action) {
      case 'app:info': return { product: PRODUCT, platform: process.platform, inProcess: !!this.opts.inProcess, version: PRODUCT.version, buildDate: this._buildDate() };
      case 'win:minimize': win && win.minimize(); return;
      case 'win:maximize': if (win) win.isMaximized() ? win.unmaximize() : win.maximize(); return;
      case 'win:close': win && win.close(); return;
      case 'main:show': this.showMain(p && p.route); return;
      case 'pick': {
        const r = await dialog.showOpenDialog(this.main || undefined, { properties: p.folders ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'] });
        return r.canceled ? [] : r.filePaths;
      }
      case 'reveal': if (p && p.path) { if (fs.existsSync(p.path)) shell.showItemInFolder(p.path); else shell.openPath(path.dirname(p.path)); } return;
      case 'external': if (p && /^https?:|^mailto:/.test(p.url)) shell.openExternal(p.url); return;
      case 'notch:size': {
        if (!this.notch || this.notch.isDestroyed()) return;
        this.notch.setBounds(this._notchBounds(p.w, p.h), false);
        return;
      }
      case 'notch:focus': if (this.notch) this.notch.focus(); return;
      case 'notch:mouse': if (this.notch && !this.notch.isDestroyed()) this.notch.setIgnoreMouseEvents(!!p.ignore, { forward: true }); return;
      case 'toast:mouse': if (this.toast) this.toast.setIgnoreMouseEvents(!p.over, { forward: true }); return;
      case 'toast:empty': if (this.toast && this.toast.isVisible()) this.toast.hide(); return;
      case 'toast:show': return this.toastShow(p);
      case 'toast:action': return this._toastAction(p);
      case 'notch:cmd': this.send(this.notch, 'notch:cmd', p); return;
      case 'onboarding:done': {
        await this.core.setSettings({ onboarded: true });
        this.settings.onboarded = true;
        setTimeout(() => { this._createNotch(); }, 300);
        return;
      }
      case 'quit': this.quit(); return;
    }
  }
  async _toastAction({ action, data }) {
    if (action === 'open-results' && data && data.scanId) this.showMain('results/' + data.scanId);
    else if (action === 'open-quarantine') this.showMain('quarantine');
    else if (action === 'quarantine' && data) {
      await this.core.applyAction({ scanId: data.scanId, path: data.path, action: 'quarantine' });
    }
  }
  _buildDate() { try { return fs.statSync(R('main', 'ui.js')).mtime.toISOString().slice(0, 10); } catch { return ''; } }
}

module.exports = { UiHost, NOTCH_IDLE };
