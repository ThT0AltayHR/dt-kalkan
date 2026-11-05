'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_WATCH_EXT = ['exe', 'dll', 'scr', 'com', 'pif', 'msi', 'bat', 'cmd', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'hta', 'lnk', 'zip', 'jar', 'docm', 'xlsm', 'doc', 'xls', 'iso', 'img'];
const DEFAULT_SCAN_EXT = DEFAULT_WATCH_EXT.concat(['sys', 'ocx', 'cpl', 'py', 'php', 'reg', 'pptm', 'rtf', 'txt', 'html', 'htm', 'sh', 'apk']);

const DEFAULTS = {
  lang: 'tr',
  onboarded: false,
  permissions: { realtime: null, startup: null, notifications: null, location: null, background: null },
  general: { closeToTray: true, startMinimized: false, startup: false, trayHintShown: false },
  protection: { realtime: true, defaultFolders: true, folders: [], autoQuarantine: true, watchExtensions: DEFAULT_WATCH_EXT },
  scan: {
    schedule: { enabled: true, frequency: 'daily', time: '13:00', weekday: 1, customHours: 6, type: 'quick', lastRun: 0 },
    fileTypes: 'smart', extensions: DEFAULT_SCAN_EXT, archiveDepth: 2, heuristics: 'normal', heuristicsEnabled: true,
    maxFileMB: 48, skipLarge: true, exclusions: [],
  },
  notch: { enabled: true, style: 'notch', position: 'center', weather: true, units: 'c', clock24: true, showProgress: true, hoverExpand: true },
  notifications: { enabled: true, scanDone: true, threats: true, quarantine: true, updates: true, duration: 6 },
  sound: { enabled: true, volume: 0.6, pack: 'soft', events: { scan: true, threat: true, notch: true, ui: true } },
  appearance: { accent: 'mint', animations: true, compact: false },
  quarantine: { retentionDays: 0 },
  updates: { auto: true, frequency: 'daily', lastCheck: 0, lastResult: null, mbAuthKey: '' },
  allowlist: [],
  stats: { threatsBlocked: 0, filesScanned: 0, lastScan: null, realtimeScanned: 0, installedAt: 0 },
};

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function merge(base, over) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  if (!isObj(over)) return out;
  for (const k of Object.keys(over)) {
    if (k === '__proto__' || k === 'constructor') continue;
    out[k] = isObj(base[k]) && isObj(over[k]) ? merge(base[k], over[k]) : over[k];
  }
  return out;
}

class JsonStore {
  constructor(file, defaults) {
    this.file = file; this.defaults = defaults;
    let data = {};
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run or corrupt */ }
    this.data = merge(defaults, data);
    this._t = null;
  }
  get() { return this.data; }
  patch(p) { this.data = merge(this.data, p); this.save(); return this.data; }
  set(d) { this.data = d; this.save(); }
  save(sync) {
    const write = () => {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
        fs.renameSync(tmp, this.file);
      } catch (e) { /* disk issue: keep in memory */ }
    };
    clearTimeout(this._t);
    if (sync) write(); else this._t = setTimeout(write, 250);
  }
}

module.exports = { JsonStore, DEFAULTS, merge, DEFAULT_WATCH_EXT, DEFAULT_SCAN_EXT };
