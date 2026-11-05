'use strict';
// Protection core: engine pool, scans, quarantine, history, real-time watcher, scheduler, updates, weather.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { execFile } = require('child_process');
const PRODUCT = require('../config/product');
const { JsonStore, DEFAULTS, merge } = require('./store');
const { Quarantine } = require('./quarantine');
const { ScanPool } = require('../engine/pool');
const { build: buildSigs, SignatureDB } = require('../engine/sigformat');

const IS_WIN = process.platform === 'win32';
const unpacked = (p) => p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');

function fmtErr(e) { return (e && (e.code || e.message)) || String(e); }

class Core extends EventEmitter {
  constructor({ userData, appRoot, execPath }) {
    super();
    this.userData = userData;
    this.appRoot = appRoot;
    this.execPath = execPath;
    this.dirs = {
      db: path.join(userData, 'db'),
      scans: path.join(userData, 'scans'),
      quarantine: path.join(userData, 'Quarantine'),
      logs: path.join(userData, 'logs'),
    };
    for (const d of Object.values(this.dirs)) fs.mkdirSync(d, { recursive: true });
    this.store = new JsonStore(path.join(userData, 'settings.json'), DEFAULTS);
    if (!this.store.get().stats.installedAt) this.store.patch({ stats: { installedAt: Date.now() } });
    // options chosen in the installer (written next to the executable by setup)
    try {
      const f = path.join(path.dirname(execPath), 'resources', 'install.json');
      const opt = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (opt && opt.stamp && this.store.get().general.installStamp !== opt.stamp) {
        this.store.patch({ general: { installStamp: opt.stamp, startup: !!opt.startup }, permissions: { startup: !!opt.startup } });
      }
    } catch { }
    this.historyFile = path.join(userData, 'history.json');
    try { this.history = JSON.parse(fs.readFileSync(this.historyFile, 'utf8')); } catch { this.history = []; }
    this.quarantine = new Quarantine(this.dirs.quarantine);
    this.activeScan = null;
    this.recentScans = this._loadScanIndex();
    this.weatherCache = null;
    this.updating = false;
    this.selfDirs = [path.dirname(execPath), userData, appRoot].map(p => path.resolve(p).toLowerCase());
  }

  // ───────── lifecycle ─────────
  init() {
    this._ensureDB();
    const s = this.settings;
    this.pool = new ScanPool({ sigPath: this.sigPath, rulesPath: this.rulesPath, settings: this._engineSettings(), allow: s.allowlist });
    this.pool.size; // spawn
    this._startWatcher();
    this._schedTimer = setInterval(() => this._tickScheduler(), 30_000);
    setTimeout(() => this._tickScheduler(), 8000);
    this.quarantine.purgeOlderThan(s.quarantine.retentionDays).catch(() => {});
    this.log('core started ' + PRODUCT.version);
    return this;
  }
  shutdown() {
    clearInterval(this._schedTimer);
    this._stopWatcher();
    if (this.pool) this.pool.close();
    this.store.save(true);
  }
  log(msg) {
    try { fs.appendFileSync(path.join(this.dirs.logs, 'core.log'), `[${new Date().toISOString()}] ${msg}\n`); } catch { }
  }
  get settings() { return this.store.get(); }

  _ensureDB() {
    const bundledSig = unpacked(path.join(this.appRoot, 'data', 'sigs.bin'));
    const bundledRules = unpacked(path.join(this.appRoot, 'data', 'rules.dat'));
    this.sigPath = path.join(this.dirs.db, 'sigs.bin');
    this.rulesPath = bundledRules;
    try {
      const b = fs.statSync(bundledSig);
      let need = !fs.existsSync(this.sigPath);
      if (!need) {
        const cur = new SignatureDB(fs.readFileSync(this.sigPath).subarray(0, 32 + 8));
        const bun = new SignatureDB(fs.readFileSync(bundledSig).subarray(0, 32 + 8));
        need = bun.created > cur.created; // shipped DB newer than the downloaded one
      }
      if (need) fs.copyFileSync(bundledSig, this.sigPath);
      void b;
    } catch (e) { this.log('db init: ' + fmtErr(e)); if (!fs.existsSync(this.sigPath)) this.sigPath = bundledSig; }
    try { this.familyNames = JSON.parse(fs.readFileSync(path.join(this.dirs.db, 'names.json'), 'utf8')); } catch { this.familyNames = {}; }
  }
  _engineSettings() {
    const s = this.settings.scan;
    return { heuristics: s.heuristics, heuristicsEnabled: s.heuristicsEnabled, archiveDepth: s.archiveDepth, maxFileMB: s.skipLarge ? s.maxFileMB : 0 };
  }
  sigInfo() {
    try {
      const fd = fs.openSync(this.sigPath, 'r'); const head = Buffer.alloc(32); fs.readSync(fd, head, 0, 32, 0); fs.closeSync(fd);
      const st = fs.statSync(this.sigPath);
      let rules = { count: 0, version: '' };
      try { rules = JSON.parse(fs.readFileSync(unpacked(path.join(this.appRoot, 'data', 'rules.json')), 'utf8')); } catch { }
      return { md5: head.readUInt32BE(12), sha256: head.readUInt32BE(16), total: head.readUInt32BE(12) + head.readUInt32BE(16), created: head.readUInt32BE(8) * 1000, bytes: st.size, rules: rules.count, rulesVersion: rules.version };
    } catch { return { total: 0, md5: 0, sha256: 0, created: 0, bytes: 0, rules: 0 }; }
  }

  // ───────── state / settings ─────────
  async getState() {
    const s = this.settings;
    return {
      product: PRODUCT, platform: process.platform, settings: s,
      sig: this.sigInfo(),
      scan: this.activeScan ? this._progress(this.activeScan) : null,
      lastScan: this.recentScans[0] || null,
      quarantine: { count: this.quarantine.items.length, bytes: this.quarantine.size() },
      protection: this._protectionStatus(),
      nextScheduled: this._nextScheduled(),
      updating: this.updating,
      elevated: await this.isElevated(),
    };
  }
  _protectionStatus() {
    const s = this.settings;
    const issues = [];
    if (!s.protection.realtime) issues.push('realtime');
    const sig = this.sigInfo();
    if (sig.created && Date.now() - sig.created > 14 * 86400000) issues.push('outdated');
    if (!s.scan.schedule.enabled) issues.push('schedule');
    const last = s.stats.lastScan;
    if (!last || Date.now() - last > 14 * 86400000) issues.push('noscan');
    const level = issues.includes('realtime') ? 'risk' : issues.length ? 'warn' : 'ok';
    return { level, issues, watching: this.watchers ? this.watchers.map(w => w.dir) : [] };
  }
  async setSettings(patch) {
    const before = this.settings;
    const next = this.store.patch(patch || {});
    // arrays must be replaced, not merged
    if (patch && patch.protection && Array.isArray(patch.protection.folders)) next.protection.folders = patch.protection.folders;
    if (patch && patch.scan && Array.isArray(patch.scan.exclusions)) next.scan.exclusions = patch.scan.exclusions;
    this.store.save();
    if (JSON.stringify(before.protection) !== JSON.stringify(next.protection)) this._restartWatcher();
    this.pool.updateSettings(this._engineSettings(), next.allowlist);
    if (patch && patch.general && typeof patch.general.startup === 'boolean') await this.setStartup(patch.general.startup).catch(e => this.log('startup: ' + fmtErr(e)));
    this.emit('state', await this.getState());
    return next;
  }
  async resetSettings() {
    const keep = { onboarded: true, stats: this.settings.stats, permissions: this.settings.permissions, allowlist: this.settings.allowlist };
    this.store.set(merge(DEFAULTS, keep)); this.store.save();
    this._restartWatcher();
    this.emit('state', await this.getState());
    return this.settings;
  }

  // ───────── history ─────────
  addHistory(type, data) {
    const e = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now(), type, data };
    this.history.unshift(e);
    if (this.history.length > 600) this.history.length = 600;
    clearTimeout(this._hT);
    this._hT = setTimeout(() => { try { fs.writeFileSync(this.historyFile, JSON.stringify(this.history)); } catch { } }, 300);
    this.emit('history', e);
    return e;
  }
  async listHistory() { return this.history; }
  async clearHistory() { this.history = []; try { fs.writeFileSync(this.historyFile, '[]'); } catch { } this.emit('history', null); return true; }

  // ───────── scan targets ─────────
  _knownFolders() {
    const home = os.homedir();
    const env = process.env;
    if (IS_WIN) {
      const up = env.USERPROFILE || home;
      return {
        downloads: path.join(up, 'Downloads'), desktop: path.join(up, 'Desktop'), documents: path.join(up, 'Documents'),
        temp: os.tmpdir(), appdata: env.APPDATA, localappdata: env.LOCALAPPDATA, programdata: env.ProgramData || 'C:\\ProgramData',
        startup: path.join(env.APPDATA || '', 'Microsoft\\Windows\\Start Menu\\Programs\\Startup'),
        startupAll: path.join(env.ProgramData || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs\\StartUp'),
        public: env.PUBLIC, wintemp: path.join(env.SystemRoot || 'C:\\Windows', 'Temp'),
      };
    }
    return { downloads: path.join(home, 'Downloads'), desktop: path.join(home, 'Desktop'), documents: path.join(home, 'Documents'), temp: os.tmpdir() };
  }
  _quickTargets() {
    const k = this._knownFolders();
    const t = [
      { dir: k.downloads, depth: 4 }, { dir: k.desktop, depth: 3 }, { dir: k.temp, depth: 3 },
      { dir: k.startup, depth: 1 }, { dir: k.startupAll, depth: 1 },
      { dir: k.appdata, depth: 2 }, { dir: k.localappdata, depth: 1 }, { dir: k.public, depth: 2 }, { dir: k.wintemp, depth: 2 },
      { dir: k.documents, depth: 2 },
    ];
    return t.filter(x => x.dir && fs.existsSync(x.dir));
  }
  _fullTargets() {
    if (IS_WIN) {
      const out = [];
      for (const L of 'CDEFGHIJKLMNOPQRSTUVWXYZ') { const r = L + ':\\'; try { fs.accessSync(r); out.push({ dir: r, depth: 64 }); } catch { } }
      return out;
    }
    return [{ dir: '/', depth: 64 }];
  }
  _isExcludedDir(p) {
    const l = path.resolve(p).toLowerCase();
    if (this.selfDirs.some(d => l === d || l.startsWith(d + path.sep))) return true;
    if (IS_WIN && /\\(windows\\winsxs|windows\\installer|system volume information|\$windows\.~bt|windows\\servicing|windows\\softwaredistribution\\download)$/i.test(l)) return true;
    if (!IS_WIN && /^\/(proc|sys|dev|run|snap)(\/|$)/.test(l)) return true;
    for (const ex of this.settings.scan.exclusions || []) { const e = path.resolve(ex).toLowerCase(); if (l === e || l.startsWith(e + path.sep)) return true; }
    return false;
  }
  _wantFile(name, mode) {
    if (mode === 'all') return true;
    const ext = path.extname(name).slice(1).toLowerCase();
    return this._scanExt.has(ext);
  }

  // ───────── scanning ─────────
  async startScan(opts = {}) {
    if (this.activeScan) return { error: 'BUSY', id: this.activeScan.id };
    const type = opts.type || 'quick';
    const s = this.settings;
    this._scanExt = new Set((s.scan.extensions || []).map(e => e.toLowerCase()));
    let targets;
    if (type === 'quick') targets = this._quickTargets();
    else if (type === 'full') targets = this._fullTargets();
    else targets = (opts.paths || []).map(p => ({ dir: p, depth: 64, explicit: true }));
    const scan = {
      id: 'S' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), type, source: opts.source || 'user', scheduled: !!opts.scheduled,
      startedAt: Date.now(), endedAt: null, status: 'running', targets: targets.map(t => t.dir),
      scanned: 0, discovered: 0, discoveryDone: false, skipped: 0, errors: 0, bytes: 0, current: '',
      threats: [], items: [], cleanCount: 0, fileMode: type === 'custom' ? 'all' : s.scan.fileTypes,
      paused: false, cancel: false,
    };
    this.activeScan = scan;
    this.addHistory('scan-start', { id: scan.id, type, scheduled: scan.scheduled });
    this.emit('scan:start', this._progress(scan));
    this._runScan(scan, targets).catch(e => { this.log('scan error ' + fmtErr(e)); });
    return { id: scan.id };
  }
  pauseScan() { if (this.activeScan) { this.activeScan.paused = true; this._emitProgress(true); } return true; }
  resumeScan() { if (this.activeScan) { this.activeScan.paused = false; this._resume && this._resume(); this._emitProgress(true); } return true; }
  cancelScan() { if (this.activeScan) { this.activeScan.cancel = true; this.activeScan.paused = false; this._resume && this._resume(); } return true; }

  _progress(s) {
    const elapsed = (s.endedAt || Date.now()) - s.startedAt;
    let percent = s.discovered ? s.scanned / s.discovered : 0;
    if (!s.discoveryDone) percent = Math.min(percent, 0.95) * (s.type === 'full' ? 0.9 : 0.97);
    if (s.status !== 'running') percent = 1;
    return {
      id: s.id, type: s.type, status: s.paused ? 'paused' : s.status, scanned: s.scanned, discovered: s.discovered, discoveryDone: s.discoveryDone,
      threats: s.threats.length, current: s.current, elapsed, startedAt: s.startedAt, endedAt: s.endedAt,
      rate: elapsed > 500 ? Math.round(s.scanned / (elapsed / 1000)) : 0, percent: Math.max(0, Math.min(1, percent)), bytes: s.bytes,
      skipped: s.skipped, errors: s.errors, cleanCount: s.cleanCount, source: s.source, scheduled: s.scheduled,
    };
  }
  _emitProgress(force) {
    const s = this.activeScan; if (!s) return;
    const t = Date.now();
    if (!force && this._lastProg && t - this._lastProg < 120) return;
    this._lastProg = t;
    this.emit('scan:progress', this._progress(s));
  }

  async _runScan(scan, targets) {
    const files = [];
    let enumDone = false;
    const maxInflight = this.pool.size * 3;
    let inflight = 0;
    let wake = null;
    const signal = () => { if (wake) { const w = wake; wake = null; w(); } };
    this._resume = signal;

    // producer
    const enumerate = async () => {
      const stack = [];
      for (const t of targets) {
        try {
          const st = await fsp.stat(t.dir);
          if (st.isFile()) { files.push(t.dir); scan.discovered++; continue; }
          stack.push([t.dir, 0, t.depth, !!t.explicit]);
        } catch { scan.errors++; }
      }
      while (stack.length && !scan.cancel) {
        const [dir, depth, maxDepth, explicit] = stack.pop();
        if (!explicit && this._isExcludedDir(dir)) continue;
        let dh;
        try { dh = await fsp.opendir(dir); } catch { continue; }
        try {
          for await (const ent of dh) {
            if (scan.cancel) break;
            const p = path.join(dir, ent.name);
            if (ent.isDirectory()) { if (depth + 1 < maxDepth && !ent.isSymbolicLink()) stack.push([p, depth + 1, maxDepth, false]); }
            else if (ent.isFile() && this._wantFile(ent.name, scan.fileMode)) {
              files.push(p); scan.discovered++;
              if (files.length > 4000) { signal(); await new Promise(r => setTimeout(r, 15)); }
            }
          }
        } catch { /* permission */ }
        signal();
        if (scan.discovered % 500 === 0) await new Promise(r => setImmediate(r));
      }
      enumDone = true; scan.discoveryDone = true; signal();
    };
    const producer = enumerate();

    const onResult = (r) => {
      inflight--;
      scan.scanned++;
      if (r.error) { if (r.error === 'EBUSY' || r.error === 'EPERM' || r.error === 'EACCES') scan.skipped++; else scan.errors++; }
      else {
        scan.bytes += r.size || 0;
        const item = this._slimResult(r);
        if (r.verdict !== 'clean') { scan.threats.push(item); this.emit('scan:threat', { scanId: scan.id, item }); }
        else { scan.cleanCount++; if (scan.items.length < 400) scan.items.push(item); }
      }
      this._emitProgress();
      signal();
    };

    while (!scan.cancel) {
      if (scan.paused) { await new Promise(r => (wake = r)); continue; }
      if (files.length && inflight < maxInflight) {
        const p = files.shift();
        scan.current = p;
        inflight++;
        this.pool.scan(p).then(onResult);
        continue;
      }
      if (enumDone && !files.length && inflight === 0) break;
      await new Promise(r => { wake = r; setTimeout(r, 250); });
    }
    if (scan.cancel) { while (inflight > 0) await new Promise(r => { wake = r; setTimeout(r, 100); }); }
    await producer.catch(() => {});
    scan.endedAt = Date.now();
    scan.status = scan.cancel ? 'canceled' : 'done';
    scan.current = '';
    const summary = this._finalizeScan(scan);
    this.activeScan = null; this._resume = null;
    if (this.settings.protection.autoQuarantine && scan.source === 'scheduled') {
      for (const t of scan.threats.filter(x => x.verdict === 'malicious')) await this.applyAction({ scanId: scan.id, path: t.path, action: 'quarantine' }).catch(() => {});
    }
    this.emit('scan:done', summary);
    this.emit('state', await this.getState());
  }
  _slimResult(r) {
    return {
      path: r.path, name: r.name || path.basename(r.path), size: r.size, verdict: r.verdict, score: r.score, threat: this._betterName(r),
      sha256: r.sha256, md5: r.md5, kind: r.kind, layers: r.layers, children: r.children,
      reasons: (r.reasons || []).map(x => ({ layer: x.layer, w: x.weight, t: x.t, matched: x.matched })), action: null, truncated: r.truncated,
    };
  }
  _betterName(r) {
    if (r.verdict !== 'clean' && r.sha256 && this.familyNames[r.sha256]) {
      const fam = this.familyNames[r.sha256];
      if (/Generic\.Sig$/.test(r.threat || '')) return `Trojan.Win32.${fam}`;
    }
    return r.threat;
  }
  _finalizeScan(scan) {
    const summary = this._progress(scan);
    const doc = {
      ...summary, targets: scan.targets, threatsList: scan.threats, items: scan.items,
    };
    try { fs.writeFileSync(path.join(this.dirs.scans, scan.id + '.json'), JSON.stringify(doc)); } catch { }
    const idx = { id: scan.id, type: scan.type, status: scan.status, startedAt: scan.startedAt, endedAt: scan.endedAt, scanned: scan.scanned, threats: scan.threats.length, source: scan.source };
    this.recentScans.unshift(idx);
    if (this.recentScans.length > 40) {
      for (const old of this.recentScans.splice(40)) fs.unlink(path.join(this.dirs.scans, old.id + '.json'), () => {});
    }
    this._saveScanIndex();
    const st = this.settings.stats;
    this.store.patch({ stats: { filesScanned: st.filesScanned + scan.scanned, lastScan: scan.status === 'done' ? Date.now() : st.lastScan, threatsBlocked: st.threatsBlocked } });
    this.addHistory('scan', { id: scan.id, type: scan.type, status: scan.status, scanned: scan.scanned, threats: scan.threats.length, elapsed: summary.elapsed, scheduled: scan.scheduled });
    return Object.assign(summary, { threatsList: scan.threats.slice(0, 50) });
  }
  _loadScanIndex() { try { return JSON.parse(fs.readFileSync(path.join(this.dirs.scans, 'index.json'), 'utf8')); } catch { return []; } }
  _saveScanIndex() { try { fs.writeFileSync(path.join(this.dirs.scans, 'index.json'), JSON.stringify(this.recentScans)); } catch { } }
  async getScan(id) {
    if (this.activeScan && this.activeScan.id === id) return Object.assign(this._progress(this.activeScan), { threatsList: this.activeScan.threats, items: this.activeScan.items, targets: this.activeScan.targets });
    try { return JSON.parse(fs.readFileSync(path.join(this.dirs.scans, id + '.json'), 'utf8')); } catch { return null; }
  }
  async listScans() { return this.recentScans; }
  _updateScanItem(scanId, filePath, patch) {
    if (!scanId) return;
    const f = path.join(this.dirs.scans, scanId + '.json');
    try {
      const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
      for (const it of doc.threatsList.concat(doc.items || [])) if (it.path === filePath) Object.assign(it, patch);
      fs.writeFileSync(f, JSON.stringify(doc));
    } catch { }
  }

  /** Scan specific files right now (drag & drop, notch, context) with priority. */
  async scanPaths(paths, opts = {}) {
    const results = [];
    const files = [];
    const walk = async (p, depth) => {
      try {
        const st = await fsp.stat(p);
        if (st.isFile()) files.push(p);
        else if (st.isDirectory() && depth < 8 && files.length < 5000) for (const e of await fsp.readdir(p)) await walk(path.join(p, e), depth + 1);
      } catch (e) { results.push({ path: p, name: path.basename(p), error: fmtErr(e), verdict: 'error' }); }
    };
    for (const p of paths) await walk(p, 0);
    const out = await Promise.all(files.map(f => this.pool.scan(f)));
    for (const r of out) results.push(r.error ? { path: r.path, name: path.basename(r.path), error: r.error, verdict: 'error' } : this._slimResult(r));
    const threats = results.filter(r => r.verdict === 'malicious' || r.verdict === 'suspicious');
    // record as a scan so the results screen + history can show it
    const id = 'D' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
    const doc = {
      id, type: opts.source === 'notch' ? 'notch' : 'drop', status: 'done', startedAt: Date.now(), endedAt: Date.now(), scanned: results.length, discovered: results.length,
      threats: threats.length, threatsList: threats, items: results.filter(r => r.verdict === 'clean').slice(0, 400), cleanCount: results.length - threats.length, percent: 1, targets: paths, source: opts.source || 'drop',
      elapsed: 0,
    };
    try { fs.writeFileSync(path.join(this.dirs.scans, id + '.json'), JSON.stringify(doc)); } catch { }
    this.recentScans.unshift({ id, type: doc.type, status: 'done', startedAt: doc.startedAt, endedAt: doc.endedAt, scanned: doc.scanned, threats: threats.length, source: doc.source });
    this._saveScanIndex();
    const st = this.settings.stats;
    this.store.patch({ stats: { filesScanned: st.filesScanned + results.length } });
    this.addHistory('scan', { id, type: doc.type, status: 'done', scanned: results.length, threats: threats.length, elapsed: 0, names: paths.slice(0, 3).map(p => path.basename(p)) });
    for (const t of threats) this.emit('scan:threat', { scanId: id, item: t });
    return { id, results, threats: threats.length };
  }

  // ───────── actions ─────────
  async applyAction({ scanId, path: filePath, action, quarantineId }) {
    const s = this.settings;
    let item = null;
    if (scanId) { const doc = await this.getScan(scanId); if (doc) item = (doc.threatsList || []).concat(doc.items || []).find(i => i.path === filePath); }
    try {
      if (action === 'quarantine') {
        const q = await this.quarantine.add(filePath, { sha256: item && item.sha256, threat: item && item.threat, verdict: item && item.verdict, score: item && item.score, source: item ? 'scan' : 'manual' });
        this._updateScanItem(scanId, filePath, { action: 'quarantined', quarantineId: q.id });
        this.store.patch({ stats: { threatsBlocked: s.stats.threatsBlocked + 1 } });
        this.addHistory('quarantine', { name: q.name, path: filePath, threat: q.threat });
        this.emit('quarantine', { type: 'add', item: q });
        this.emit('state', await this.getState());
        return { ok: true, quarantineId: q.id };
      }
      if (action === 'delete') {
        await fsp.unlink(filePath);
        this._updateScanItem(scanId, filePath, { action: 'deleted' });
        this.store.patch({ stats: { threatsBlocked: s.stats.threatsBlocked + 1 } });
        this.addHistory('delete', { name: path.basename(filePath), path: filePath, threat: item && item.threat });
        this.emit('state', await this.getState());
        return { ok: true };
      }
      if (action === 'ignore') {
        let sha = item && item.sha256;
        if (!sha) sha = await this._sha256(filePath);
        if (sha && !s.allowlist.includes(sha)) this.store.set(Object.assign(this.settings, { allowlist: s.allowlist.concat([sha]) }));
        this.pool.updateSettings(this._engineSettings(), this.settings.allowlist);
        this._updateScanItem(scanId, filePath, { action: 'ignored' });
        this.addHistory('ignore', { name: path.basename(filePath), path: filePath, threat: item && item.threat });
        return { ok: true };
      }
      if (action === 'restore') {
        const qid = quarantineId || (item && item.quarantineId);
        const r = await this.restoreQuarantine(qid);
        this._updateScanItem(scanId, filePath, { action: 'restored' });
        return r;
      }
      return { ok: false, error: 'UNKNOWN_ACTION' };
    } catch (e) {
      this.log(`action ${action} failed: ${fmtErr(e)}`);
      return { ok: false, error: fmtErr(e) };
    }
  }
  _sha256(p) { return new Promise((res) => { const h = crypto.createHash('sha256'); fs.createReadStream(p).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', () => res(null)); }); }
  async listQuarantine() { return this.quarantine.list(); }
  async restoreQuarantine(id) {
    const item = this.quarantine.get(id);
    if (!item) return { ok: false, error: 'NOT_FOUND' };
    this._ignoreWatch.add(item.originalPath.toLowerCase());
    setTimeout(() => this._ignoreWatch.delete(item.originalPath.toLowerCase()), 15000);
    const r = await this.quarantine.restore(id);
    const s = this.settings;
    if (item.sha256 && !s.allowlist.includes(item.sha256)) { this.store.set(Object.assign(s, { allowlist: s.allowlist.concat([item.sha256]) })); this.pool.updateSettings(this._engineSettings(), this.settings.allowlist); }
    this.addHistory('restore', { name: item.name, path: r.restoredTo, threat: item.threat });
    this.emit('quarantine', { type: 'restore', item });
    this.emit('state', await this.getState());
    return { ok: true, restoredTo: r.restoredTo };
  }
  async deleteQuarantine(id) {
    const item = await this.quarantine.remove(id);
    if (item) this.addHistory('qdelete', { name: item.name, threat: item.threat });
    this.emit('quarantine', { type: 'delete', item });
    this.emit('state', await this.getState());
    return { ok: !!item };
  }
  async deleteAllQuarantine() { for (const i of this.quarantine.list()) await this.quarantine.remove(i.id); this.addHistory('qdelete', { all: true }); this.emit('state', await this.getState()); return { ok: true }; }
  async removeAllow(sha) { const s = this.settings; this.store.set(Object.assign(s, { allowlist: s.allowlist.filter(x => x !== sha) })); this.pool.updateSettings(this._engineSettings(), this.settings.allowlist); return this.settings.allowlist; }

  // ───────── real-time protection ─────────
  _watchDirs() {
    const s = this.settings.protection;
    const k = this._knownFolders();
    const dirs = [];
    if (s.defaultFolders) dirs.push(k.downloads, k.desktop, k.temp);
    for (const f of s.folders || []) dirs.push(f);
    return [...new Set(dirs.filter(d => d && fs.existsSync(d)).map(d => path.resolve(d)))];
  }
  _startWatcher() {
    this._ignoreWatch = this._ignoreWatch || new Set();
    this.watchers = [];
    const s = this.settings.protection;
    if (!s.realtime) return;
    const exts = new Set((s.watchExtensions || []).map(x => x.toLowerCase()));
    this._pendingRT = this._pendingRT || new Map();
    for (const dir of this._watchDirs()) {
      try {
        const w = fs.watch(dir, { recursive: true, persistent: true }, (ev, name) => {
          if (!name) return;
          const p = path.join(dir, name.toString());
          const ext = path.extname(p).slice(1).toLowerCase();
          if (!exts.has(ext)) return;
          if (this._isExcludedDir(path.dirname(p)) || this._ignoreWatch.has(p.toLowerCase())) return;
          clearTimeout(this._pendingRT.get(p));
          this._pendingRT.set(p, setTimeout(() => { this._pendingRT.delete(p); this._rtScan(p).catch(() => {}); }, 1200));
        });
        w.on('error', () => {});
        this.watchers.push({ dir, w });
      } catch (e) { this.log('watch fail ' + dir + ': ' + fmtErr(e)); }
    }
    this.log('realtime watching: ' + this.watchers.map(w => w.dir).join(', '));
  }
  _stopWatcher() { for (const { w } of this.watchers || []) try { w.close(); } catch { } this.watchers = []; }
  _restartWatcher() { this._stopWatcher(); this._startWatcher(); }
  async _rtScan(p) {
    // wait until the file is stable (download finished)
    let last = -1;
    for (let i = 0; i < 20; i++) {
      let st; try { st = await fsp.stat(p); } catch { return; }
      if (!st.isFile()) return;
      if (st.size === last && st.size > 0) break;
      last = st.size; await new Promise(r => setTimeout(r, 500));
    }
    const r = await this.pool.scan(p);
    const st = this.settings.stats;
    this.store.patch({ stats: { realtimeScanned: (st.realtimeScanned || 0) + 1 } });
    if (r.error || r.verdict === 'clean') { this.emit('realtime', { path: p, verdict: r.verdict || 'error' }); return; }
    const item = this._slimResult(r);
    let action = null;
    if (r.verdict === 'malicious' && this.settings.protection.autoQuarantine) {
      try { const q = await this.quarantine.add(p, { sha256: r.sha256, threat: item.threat, verdict: r.verdict, score: r.score, source: 'realtime' }); action = 'quarantined'; item.quarantineId = q.id; this.store.patch({ stats: { threatsBlocked: this.settings.stats.threatsBlocked + 1 } }); this.emit('quarantine', { type: 'add', item: q }); }
      catch (e) { action = 'failed'; }
    }
    item.action = action;
    const rec = await this.scanPathsRecord([item], 'realtime');
    this.addHistory('realtime', { name: item.name, path: p, threat: item.threat, verdict: item.verdict, action, scanId: rec });
    this.emit('threat', { source: 'realtime', item, action, scanId: rec });
    this.emit('state', await this.getState());
  }
  async scanPathsRecord(items, source) {
    const id = 'R' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
    const doc = { id, type: source, status: 'done', startedAt: Date.now(), endedAt: Date.now(), scanned: items.length, threats: items.length, threatsList: items, items: [], percent: 1, source, elapsed: 0, cleanCount: 0 };
    try { fs.writeFileSync(path.join(this.dirs.scans, id + '.json'), JSON.stringify(doc)); } catch { }
    this.recentScans.unshift({ id, type: source, status: 'done', startedAt: doc.startedAt, endedAt: doc.endedAt, scanned: items.length, threats: items.length, source });
    this._saveScanIndex();
    return id;
  }

  // ───────── scheduler ─────────
  _nextScheduled() {
    const sc = this.settings.scan.schedule;
    if (!sc.enabled) return null;
    const last = sc.lastRun || 0, nowD = new Date();
    const [hh, mm] = (sc.time || '13:00').split(':').map(Number);
    if (sc.frequency === 'hourly') return Math.max(Date.now(), last + 3600000);
    if (sc.frequency === 'custom') return Math.max(Date.now(), last + Math.max(1, sc.customHours || 6) * 3600000);
    const d = new Date(nowD); d.setHours(hh, mm, 0, 0);
    if (sc.frequency === 'daily') { if (d.getTime() <= last || d.getTime() < Date.now() - 6 * 3600000) d.setDate(d.getDate() + 1); return d.getTime(); }
    // weekly
    const wd = sc.weekday ?? 1;
    let add = (wd - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + add);
    if (d.getTime() <= last || d.getTime() < Date.now() - 6 * 3600000) d.setDate(d.getDate() + 7);
    return d.getTime();
  }
  _tickScheduler() {
    const s = this.settings;
    const sc = s.scan.schedule;
    if (sc.enabled && !this.activeScan) {
      const next = this._nextScheduled();
      if (next && next <= Date.now()) {
        this.store.patch({ scan: { schedule: { lastRun: Date.now() } } });
        this.startScan({ type: sc.type || 'quick', scheduled: true, source: 'scheduled' });
      }
    }
    // automatic signature updates
    const u = s.updates;
    if (u.auto && !this.updating) {
      const every = u.frequency === 'weekly' ? 7 * 86400000 : u.frequency === 'hourly' ? 3600000 : 86400000;
      if (Date.now() - (u.lastCheck || 0) > every && Date.now() - (this._bootAt || (this._bootAt = Date.now())) > 120000) this.updateSignatures({ auto: true }).catch(() => {});
    }
  }

  // ───────── signature updates ─────────
  async _fetch(url, opts = {}, timeout = 45000) {
    const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(timeout), headers: Object.assign({ 'User-Agent': `${PRODUCT.name}/${PRODUCT.version}` }, opts.headers || {}) }, opts));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r;
  }
  async updateSignatures({ auto } = {}) {
    if (this.updating) return { ok: false, error: 'BUSY' };
    this.updating = true;
    const prog = (stage, pct, extra) => this.emit('update:progress', Object.assign({ stage, pct }, extra || {}));
    const md5 = [], sha = [];
    const names = Object.assign({}, this.familyNames);
    const sources = [];
    try {
      prog('index', 0.02);
      // 1) VirusShare MD5 lists (newest 30)
      try {
        const idx = await (await this._fetch('https://virusshare.com/hashes')).text();
        const nums = [...new Set([...idx.matchAll(/VirusShare_(\d{5})\.md5/g)].map(m => +m[1]))].sort((a, b) => b - a).slice(0, 30);
        let done = 0;
        const worker = async () => {
          while (nums.length) {
            const n = nums.shift();
            try {
              const t = await (await this._fetch(`https://virusshare.com/hashfiles/VirusShare_${String(n).padStart(5, '0')}.md5`, {}, 90000)).text();
              for (const l of t.split('\n')) { const h = l.trim(); if (h.length === 32 && h[0] !== '#') md5.push(h); }
            } catch { }
            done++; prog('download', 0.05 + 0.75 * (done / 30), { source: 'VirusShare', done, total: 30 });
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        if (md5.length) sources.push({ name: 'VirusShare', count: md5.length });
      } catch (e) { this.log('vs: ' + fmtErr(e)); }
      // 2) MalShare daily SHA-256
      try {
        const t = await (await this._fetch('https://www.malshare.com/daily/malshare.current.sha256.txt')).text();
        let c = 0; for (const l of t.split('\n')) { const h = l.trim(); if (h.length === 64) { sha.push(h); c++; } }
        if (c) sources.push({ name: 'MalShare', count: c });
      } catch (e) { this.log('malshare: ' + fmtErr(e)); }
      prog('download', 0.82);
      // 3) MalwareBazaar recent (needs a free Auth-Key since 2025)
      const key = this.settings.updates.mbAuthKey;
      if (key) {
        try {
          const r = await this._fetch('https://mb-api.abuse.ch/api/v1/', { method: 'POST', headers: { 'Auth-Key': key, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'query=get_recent&selector=time' });
          const j = await r.json();
          let c = 0;
          for (const d of j.data || []) { if (d.sha256_hash) { sha.push(d.sha256_hash); c++; if (d.signature) names[d.sha256_hash] = String(d.signature).replace(/[^\w.-]/g, ''); } if (d.md5_hash) md5.push(d.md5_hash); }
          if (c) sources.push({ name: 'MalwareBazaar', count: c });
        } catch (e) { this.log('mb: ' + fmtErr(e)); }
      }
      if (!md5.length && !sha.length) throw new Error('NO_SOURCES');
      prog('build', 0.88);
      // merge with existing database contents (keep previously known hashes)
      const cur = new SignatureDB(fs.readFileSync(this.sigPath));
      const oldMd5 = [], oldSha = [];
      for (let i = 0; i < cur.md5Count; i++) oldMd5.push(cur.buf.toString('hex', cur.md5Off + i * 8, cur.md5Off + i * 8 + 8) + '0'.repeat(16));
      for (let i = 0; i < cur.sha256Count; i++) oldSha.push(cur.buf.toString('hex', cur.shaOff + i * 32, cur.shaOff + i * 32 + 32));
      const before = cur.total;
      const out = buildSigs({ md5: oldMd5.concat(md5), sha256: oldSha.concat(sha) });
      const tmp = this.sigPath + '.new';
      fs.writeFileSync(tmp, out); fs.renameSync(tmp, path.join(this.dirs.db, 'sigs.bin'));
      this.sigPath = path.join(this.dirs.db, 'sigs.bin');
      this.familyNames = names;
      try { fs.writeFileSync(path.join(this.dirs.db, 'names.json'), JSON.stringify(names)); } catch { }
      this.pool.reload(this.sigPath);
      const info = this.sigInfo();
      const result = { ok: true, total: info.total, added: info.total - before, sources, at: Date.now() };
      this.store.patch({ updates: { lastCheck: Date.now(), lastResult: result } });
      this.addHistory('update', { total: info.total, added: result.added, sources: sources.map(s => s.name), auto: !!auto });
      prog('done', 1, result);
      this.emit('update:done', result);
      this.emit('state', await this.getState());
      return result;
    } catch (e) {
      const result = { ok: false, error: fmtErr(e), at: Date.now() };
      this.store.patch({ updates: { lastCheck: Date.now(), lastResult: result } });
      this.addHistory('update-fail', { error: result.error });
      prog('error', 1, result);
      this.emit('update:done', result);
      return result;
    } finally { this.updating = false; }
  }

  // ───────── weather ─────────
  async getWeather(force) {
    const s = this.settings;
    if (!s.notch.weather || s.permissions.location === false) return null;
    if (!force && this.weatherCache && Date.now() - this.weatherCache.at < 30 * 60000) return this.weatherCache;
    try {
      let loc = this._loc;
      if (!loc || force) {
        try {
          const j = await (await this._fetch('https://ipapi.co/json/', {}, 8000)).json();
          if (j && j.latitude) loc = { lat: j.latitude, lon: j.longitude, city: j.city, country: j.country_name };
        } catch { }
        if (!loc) {
          const j = await (await this._fetch('http://ip-api.com/json/?fields=status,lat,lon,city,country', {}, 8000)).json();
          if (j && j.status === 'success') loc = { lat: j.lat, lon: j.lon, city: j.city, country: j.country };
        }
        this._loc = loc;
      }
      if (!loc) throw new Error('NO_LOCATION');
      const unit = s.notch.units === 'f' ? '&temperature_unit=fahrenheit' : '';
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto&forecast_days=1${unit}`;
      const w = await (await this._fetch(url, {}, 10000)).json();
      this.weatherCache = {
        at: Date.now(), city: loc.city, country: loc.country, unit: s.notch.units,
        temp: w.current.temperature_2m, feels: w.current.apparent_temperature, code: w.current.weather_code, isDay: w.current.is_day,
        wind: w.current.wind_speed_10m, humidity: w.current.relative_humidity_2m,
        max: w.daily.temperature_2m_max[0], min: w.daily.temperature_2m_min[0], sunrise: w.daily.sunrise[0], sunset: w.daily.sunset[0],
      };
      return this.weatherCache;
    } catch (e) {
      this.log('weather: ' + fmtErr(e));
      return this.weatherCache || null;
    }
  }

  // ───────── system ─────────
  isElevated() {
    if (this._elev !== undefined) return Promise.resolve(this._elev);
    return new Promise((res) => {
      if (!IS_WIN) { this._elev = process.getuid ? process.getuid() === 0 : false; return res(this._elev); }
      execFile('net', ['session'], { windowsHide: true }, (err) => { this._elev = !err; res(this._elev); });
    });
  }
  setStartup(enable) {
    return new Promise((resolve) => {
      if (!IS_WIN) return resolve({ ok: true, simulated: true });
      const exe = process.env.DT_PORTABLE_EXE || this.execPath;
      const task = `${PRODUCT.name} Autostart`;
      const args = enable
        ? ['/Create', '/TN', task, '/TR', `"${exe}" --hidden`, '/SC', 'ONLOGON', '/RL', 'HIGHEST', '/F']
        : ['/Delete', '/TN', task, '/F'];
      execFile('schtasks', args, { windowsHide: true }, (err, so, se) => {
        if (err && enable) this.log('schtasks: ' + (se || err.message));
        resolve({ ok: !err || !enable, error: err ? String(se || err.message) : null });
      });
    });
  }
  async systemInfo() {
    return { os: `${os.type()} ${os.release()}`, arch: os.arch(), cpus: os.cpus().length, mem: os.totalmem(), host: os.hostname(), user: os.userInfo().username, version: PRODUCT.version, elevated: await this.isElevated(), workers: this.pool ? this.pool.size : 0 };
  }
  async knownFolders() { return this._knownFolders(); }
}

// Methods exposed over RPC (UI process ↔ core process)
Core.RPC_METHODS = ['getState', 'setSettings', 'resetSettings', 'startScan', 'pauseScan', 'resumeScan', 'cancelScan', 'getScan', 'listScans', 'scanPaths', 'applyAction',
  'listQuarantine', 'restoreQuarantine', 'deleteQuarantine', 'deleteAllQuarantine', 'removeAllow', 'listHistory', 'clearHistory', 'updateSignatures', 'getWeather',
  'systemInfo', 'knownFolders', 'setStartup', 'sigInfo'];
Core.EVENTS = ['state', 'scan:start', 'scan:progress', 'scan:done', 'scan:threat', 'threat', 'realtime', 'quarantine', 'history', 'update:progress', 'update:done'];

module.exports = { Core };
