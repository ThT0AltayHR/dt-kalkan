// Screenshot harness only (not shipped): emulates the Android native bridge (window.DTNative) with realistic
// mock data so the real web UI can be rendered in a phone-sized Chromium window. Verdicts/reasons for the sample
// files and the synthetic APKs come from the Kotlin engine (engine-results.jsonl, produced by the engine CLI).
const fs = require('fs'), path = require('path');
const CAP = process.env.DT_CAP_DIR || __dirname;
const SCN = (() => { try { return JSON.parse(decodeURIComponent(escape(atob(new URLSearchParams(location.search).get('scene') || 'e30=')))); } catch (e) { return {}; } })();
window.__scene = SCN;
const ENGINE = fs.readFileSync(path.join(process.env.DT_TOOLS || '/workspace/tools/cap', 'engine-results.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const byName = (n) => ENGINE.find(e => e.path.endsWith('/' + n));
const NOW = new Date(2026, 10, 4, 14, 32, 0).getTime();
window.__dtClock = new Date(NOW);
// freeze "now" at the mock time (status bar 14:32) so relative times are consistent across shots
const patchDate = (w) => { const RD = w.Date; if (RD.__mock) return; const off = NOW - RD.now(); class MD extends RD { constructor(...a) { if (!a.length) super(RD.now() + off); else super(...a); } static now() { return RD.now() + off; } } MD.__mock = true; w.Date = MD; };
patchDate(window);
window.addEventListener('DOMContentLoaded', () => document.querySelectorAll('iframe').forEach(f => { const p = () => { try { patchDate(f.contentWindow); } catch (e) { } }; p(); f.addEventListener('load', p); }));
window.addEventListener('error', (e) => console.error('ERR', e.message, (e.filename || '').split('/').pop() + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => console.error('REJ', e.reason && (e.reason.stack || e.reason)));
const DL = '/storage/emulated/0/Download/';

function icon(bg1, bg2, glyph, fg = '#fff') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs><rect width="96" height="96" rx="0" fill="url(#g)"/>${glyph.replace(/FG/g, fg)}</svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}
const G = {
  notes: '<rect x="26" y="22" width="44" height="54" rx="7" fill="FG"/><path d="M34 38h28M34 48h28M34 58h18" stroke="#E0A800" stroke-width="4" stroke-linecap="round"/>',
  sun: '<circle cx="48" cy="44" r="14" fill="FG"/><path d="M48 20v8M48 60v8M24 44h8M64 44h8M31 27l6 6M59 55l6 6M65 27l-6 6M37 55l-6 6" stroke="FG" stroke-width="4" stroke-linecap="round"/><path d="M30 72h36" stroke="FG" stroke-width="5" stroke-linecap="round" opacity=".6"/>',
  photo: '<circle cx="40" cy="40" r="14" fill="#FFCF4A"/><circle cx="56" cy="40" r="14" fill="#FF6B6B" opacity=".9"/><circle cx="40" cy="56" r="14" fill="#4DA3FF" opacity=".9"/><circle cx="56" cy="56" r="14" fill="#45D483" opacity=".9"/>',
  music: '<path d="M58 24v34a9 9 0 11-6-8.5V32l-16 4v26a9 9 0 11-6-8.5V30z" fill="FG"/>',
  cal: '<rect x="22" y="24" width="52" height="50" rx="9" fill="FG"/><rect x="22" y="24" width="52" height="14" rx="7" fill="#FF5A5F"/><text x="48" y="66" font-family="Arial" font-weight="700" font-size="26" text-anchor="middle" fill="#222">4</text>',
  cam: '<rect x="20" y="32" width="56" height="38" rx="9" fill="FG"/><circle cx="48" cy="51" r="12" fill="#2B2F38"/><circle cx="48" cy="51" r="6" fill="#6C7A92"/><rect x="38" y="25" width="20" height="9" rx="3" fill="FG"/>',
  pin: '<path d="M48 18c-12 0-20 9-20 20 0 15 20 36 20 36s20-21 20-36c0-11-8-20-20-20z" fill="FG"/><circle cx="48" cy="38" r="8" fill="#1E9E5A"/>',
  bank: '<path d="M22 40l26-16 26 16z" fill="FG"/><path d="M28 44h8v20h-8zM44 44h8v20h-8zM60 44h8v20h-8z" fill="FG"/><rect x="22" y="66" width="52" height="6" rx="2" fill="FG"/>',
  chat: '<path d="M24 30a8 8 0 018-8h32a8 8 0 018 8v24a8 8 0 01-8 8H42l-12 10v-10h-2a8 8 0 01-4-6z" fill="FG"/>',
  folder: '<path d="M20 30a6 6 0 016-6h14l6 7h24a6 6 0 016 6v29a6 6 0 01-6 6H26a6 6 0 01-6-6z" fill="FG"/>',
  calc: '<rect x="26" y="20" width="44" height="56" rx="8" fill="FG"/><rect x="32" y="27" width="32" height="12" rx="3" fill="#8E7CF8"/><g fill="#8E7CF8"><circle cx="37" cy="50" r="4"/><circle cx="48" cy="50" r="4"/><circle cx="59" cy="50" r="4"/><circle cx="37" cy="63" r="4"/><circle cx="48" cy="63" r="4"/><circle cx="59" cy="63" r="4"/></g>',
  clock: '<circle cx="48" cy="48" r="26" fill="FG"/><path d="M48 32v17l11 7" stroke="#1D2433" stroke-width="5" stroke-linecap="round" fill="none"/>',
  run: '<circle cx="54" cy="24" r="7" fill="FG"/><path d="M38 70l8-18 10 8v16M46 52l4-16-12 4-6 10M50 36l10 10h10" stroke="FG" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  book: '<path d="M24 26c10-4 18-2 24 4 6-6 14-8 24-4v44c-10-4-18-2-24 4-6-6-14-8-24-4z" fill="FG"/><path d="M48 30v44" stroke="#C2410C" stroke-width="3"/>',
  cart: '<path d="M22 26h8l7 30h30l6-22H34" stroke="FG" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="40" cy="68" r="5" fill="FG"/><circle cx="62" cy="68" r="5" fill="FG"/>',
  gear: '<circle cx="48" cy="48" r="12" fill="none" stroke="FG" stroke-width="8"/><path d="M48 18v10M48 68v10M18 48h10M68 48h10M27 27l7 7M62 62l7 7M69 27l-7 7M34 62l-7 7" stroke="FG" stroke-width="8" stroke-linecap="round"/>',
  game: '<rect x="18" y="34" width="60" height="32" rx="16" fill="FG"/><path d="M34 44v12M28 50h12" stroke="#7C3AED" stroke-width="5" stroke-linecap="round"/><circle cx="60" cy="46" r="4" fill="#7C3AED"/><circle cx="66" cy="54" r="4" fill="#7C3AED"/>',
  mail: '<rect x="20" y="28" width="56" height="40" rx="8" fill="FG"/><path d="M22 32l26 20 26-20" stroke="#E5484D" stroke-width="5" fill="none" stroke-linejoin="round"/>',
  pod: '<circle cx="48" cy="42" r="14" fill="none" stroke="FG" stroke-width="6"/><path d="M48 56v18" stroke="FG" stroke-width="6" stroke-linecap="round"/><circle cx="48" cy="42" r="5" fill="FG"/>',
  shield: '<path d="M48 18l24 9v18c0 15-10 27-24 31-14-4-24-16-24-31V27z" fill="FG"/>',
};
const APPS = [
  ['Bankam', 'com.bankam.mobil', '#1E3A8A', '#2563EB', 'bank', 'store', 61e6, 14],
  ['Dosyalarım', 'com.files.manager', '#0EA5E9', '#2563EB', 'folder', 'store', 9e6, 6],
  ['Fotoğraflar', 'com.photos.gallery', '#FFFFFF', '#E8EDF5', 'photo', 'store', 38e6, 9],
  ['Hava Durumu', 'com.weather.tr', '#38BDF8', '#0EA5E9', 'sun', 'store', 22e6, 7],
  ['Hesap Makinesi', 'com.calc.pro', '#6D28D9', '#8B5CF6', 'calc', 'store', 4e6, 1],
  ['Kamera Pro', 'com.camera.pro', '#475569', '#1E293B', 'cam', 'store', 31e6, 8],
  ['Kitaplık', 'com.reader.books', '#F97316', '#EA580C', 'book', 'store', 27e6, 5],
  ['Market', 'com.market.alisveris', '#16A34A', '#15803D', 'cart', 'store', 48e6, 11],
  ['Mesajlar', 'com.chat.messenger', '#22C55E', '#16A34A', 'chat', 'store', 84e6, 22],
  ['Müzik', 'com.music.stream', '#EC4899', '#DB2777', 'music', 'store', 71e6, 12],
  ['Notlar', 'com.dttest.notes', '#FDE047', '#FACC15', 'notes', 'store', 6e6, 1],
  ['Oyun Dünyası', 'com.games.world', '#7C3AED', '#A855F7', 'game', 'store', 212e6, 9],
  ['Podcast', 'com.podcast.player', '#A855F7', '#7E22CE', 'pod', 'store', 19e6, 6],
  ['Posta', 'com.mail.client', '#F1F5F9', '#E2E8F0', 'mail', 'store', 33e6, 10],
  ['Saat', 'com.clock.alarm', '#0F172A', '#334155', 'clock', 'store', 5e6, 4],
  ['Sistem Güncelleme', 'com.android.system.update.service', '#9CA3AF', '#6B7280', 'gear', null, 2.1e6, 9],
  ['Spor', 'com.fitness.run', '#F43F5E', '#E11D48', 'run', 'store', 41e6, 13],
  ['Takvim', 'com.calendar.app', '#F8FAFC', '#E2E8F0', 'cal', 'store', 12e6, 5],
  ['Haritalar', 'com.maps.nav', '#22C55E', '#15803D', 'pin', 'store', 95e6, 16],
  ['Kalkan VPN', 'com.vpn.secure', '#0F766E', '#14B8A6', 'shield', 'store', 18e6, 6],
];
const ICONS = {}; for (const a of APPS) ICONS[a[1]] = icon(a[2], a[3], G[a[4]], ['#FFFFFF', '#F8FAFC', '#F1F5F9', '#FDE047'].includes(a[2]) ? '#334155' : '#fff');
window.__mockIcons = ICONS;
const THREAT_PKG = 'com.android.system.update.service';
const lastVerdict = SCN.appVerdicts || {};

const DEF = { lang: 'tr', onboarded: true,
  permissions: { storage: true, notifications: true, location: true, overlay: true, background: true, apps: true },
  general: { startup: true, keepRunning: true, startMinimized: false, trayHintShown: true },
  protection: { realtime: true, defaultFolders: true, folders: [], autoQuarantine: true, scanNewApps: true, watchExtensions: ['exe', 'dll', 'scr', 'com', 'pif', 'msi', 'bat', 'cmd', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'hta', 'lnk', 'zip', 'jar', 'docm', 'xlsm', 'doc', 'xls', 'iso', 'img', 'apk', 'apks', 'xapk', 'apkm', 'dex'] },
  scan: { schedule: { enabled: true, frequency: 'daily', time: '13:00', weekday: 1, customHours: 6, type: 'quick', lastRun: NOW - 5.5 * 3600e3 }, fileTypes: 'smart', extensions: [], archiveDepth: 2, heuristics: 'normal', heuristicsEnabled: true, maxFileMB: 48, skipLarge: true, exclusions: [], includeSystemApps: false },
  notch: { enabled: true, style: 'notch', position: 'center', weather: true, units: 'c', clock24: true, showProgress: true, hoverExpand: true },
  notifications: { enabled: true, scanDone: true, threats: true, quarantine: true, updates: true, duration: 6 },
  sound: { enabled: true, volume: 0.6, pack: 'soft', events: { scan: true, threat: true, notch: true, ui: true } },
  appearance: { accent: 'mint', animations: true, compact: false }, quarantine: { retentionDays: 30 },
  updates: { auto: true, frequency: 'daily', lastCheck: NOW - 2 * 3600e3, lastResult: { ok: true, total: 1900548, added: 4211, at: NOW - 2 * 3600e3 }, mbAuthKey: '' },
  allowlist: [], stats: { threatsBlocked: 7, filesScanned: 18432, lastScan: NOW - 5.5 * 3600e3, realtimeScanned: 263, installedAt: NOW - 12 * 86400e3, appsScanned: 41 } };
const merge = (a, b) => { const o = Array.isArray(a) ? a.slice() : Object.assign({}, a); if (!b || typeof b !== 'object' || Array.isArray(b)) return o; for (const k of Object.keys(b)) o[k] = a && typeof a[k] === 'object' && !Array.isArray(a[k]) && b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) ? merge(a[k], b[k]) : b[k]; return o; };
let settings = merge(DEF, SCN.settings || {});
const perms = Object.assign({ storage: true, notifications: true, location: true, overlay: true, background: true, apps: true }, SCN.perms || {});

function item(file, over) {
  const e = byName(file); const name = over && over.name || file;
  return Object.assign({ path: DL + file, name, size: e.size, verdict: e.verdict, score: e.score, threat: e.threat, sha256: e.sha256, md5: e.md5, kind: e.kind, reasons: e.full, action: null, layers: {}, children: [] }, over || {});
}
const tApk = byName('dt-test-threat.apk'), cApk = byName('dt-test-clean.apk');
const threatApp = { path: 'app://' + THREAT_PKG, name: 'Sistem Güncelleme', pkg: THREAT_PKG, kind: 'app', size: 2.1e6, verdict: tApk.verdict, score: tApk.score, threat: tApk.threat, sha256: tApk.sha256, reasons: tApk.full.concat([{ layer: 'heuristic', w: 5, t: { tr: 'Bilinen bir uygulama mağazası dışından yüklendi (bilinmeyen kaynak)', en: 'Installed from outside a known store (unknown source)' } }]), apk: { package: THREAT_PKG, permissions: tApk.perms, hasLauncher: false }, action: null };
const appItem = (a) => ({ path: 'app://' + a[1], name: a[0], pkg: a[1], kind: 'app', size: a[6], verdict: 'clean', score: 0, threat: null, sha256: cApk.sha256, reasons: [], action: null });
const cleanItems = APPS.filter(a => a[1] !== THREAT_PKG).map(appItem).concat(['notlar.txt', 'script_temiz.ps1', 'fotograflar.zip', 'temiz_uygulama.exe'].map(f => item(f)));
const DOCS = {
  Sclean: { id: 'Sclean', type: 'quick', status: 'done', startedAt: NOW - 140e3, endedAt: NOW - 4e3, scanned: 412, discovered: 412, threats: 0, threatsList: [], items: cleanItems, cleanCount: 412, elapsed: 136e3, percent: 1 },
  Sthreat: { id: 'Sthreat', type: 'quick', status: 'done', startedAt: NOW - 160e3, endedAt: NOW - 3e3, scanned: 418, discovered: 418, threats: 6, cleanCount: 412, elapsed: 157e3, percent: 1, items: cleanItems,
    threatsList: [threatApp, item('eicar.com'), item('eicar_arsiv.zip'), item('fatura.pdf.vbs'), item('oyun_hilesi_injector.exe'), item('kurulum_yardimcisi.exe')] },
};
if (SCN.actionsDone) { DOCS.Sthreat.threatsList[1].action = 'quarantined'; DOCS.Sthreat.threatsList[2].action = 'quarantined'; DOCS.Sthreat.threatsList[5].action = 'ignored'; }
const H = (ago, type, data) => ({ id: 'h' + ago, ts: NOW - ago * 60e3, type, data });
const HISTORY = [
  H(3, 'scan', { id: 'Sthreat', type: 'quick', status: 'done', scanned: 418, threats: 6 }), H(9, 'quarantine', { name: 'eicar.com', threat: 'EICAR-Test-File' }),
  H(26, 'realtime', { name: 'fatura.pdf.vbs', threat: 'Trojan-Dropper.VBS.Agent', action: 'quarantined', scanId: 'Sthreat' }), H(52, 'scan', { id: 'Dapp', type: 'notch', status: 'done', scanned: 1, threats: 0, names: ['Bankam'] }),
  H(120, 'update', { total: 1900548, added: 4211, sources: ['VirusShare', 'MalShare'] }), H(330, 'scan', { id: 'Sclean', type: 'quick', status: 'done', scanned: 412, threats: 0, scheduled: true }),
  H(1500, 'ignore', { name: 'kurulum_yardimcisi.exe', threat: 'HEUR:Packed.Win32.Generic' }), H(1560, 'scan', { id: 'Sclean', type: 'full', status: 'done', scanned: 18020, threats: 1 }),
  H(1700, 'uninstall', { name: 'Fener Pro', threat: 'Trojan-SMS.AndroidOS.Agent' }), H(2900, 'update', { total: 1896337, added: 3870, sources: ['VirusShare', 'MalShare'] }),
];
const QUAR = [
  { id: 'q1', name: 'eicar.com', originalPath: DL + 'eicar.com', size: 68, date: NOW - 9 * 60e3, threat: 'EICAR-Test-File', verdict: 'malicious', score: 100 },
  { id: 'q2', name: 'fatura.pdf.vbs', originalPath: DL + 'fatura.pdf.vbs', size: byName('fatura.pdf.vbs').size, date: NOW - 26 * 60e3, threat: 'Trojan-Dropper.VBS.Agent', verdict: 'malicious', score: 87 },
  { id: 'q3', name: 'oyun_hilesi_injector.exe', originalPath: DL + 'Oyunlar/oyun_hilesi_injector.exe', size: byName('oyun_hilesi_injector.exe').size, date: NOW - 26 * 3600e3, threat: 'HEUR:Trojan.Win32.Injector.Gen', verdict: 'malicious', score: 85 },
];
let quar = SCN.emptyQuarantine ? [] : QUAR.slice();
let scan = null;
const listeners = [];
const emit = (n, d) => { try { window.__dtEvt && window.__dtEvt(n, JSON.parse(JSON.stringify(d === undefined ? null : d))); } catch (e) { console.error(e); } };
window.__mock = { emit, settings: () => settings, DOCS, threatApp, ICONS, NOW };
function prot() {
  const issues = []; if (!settings.protection.realtime) issues.push('realtime'); if (!perms.storage) issues.push('storage'); if (!settings.scan.schedule.enabled) issues.push('schedule');
  return { level: issues.includes('realtime') ? 'risk' : issues.length ? 'warn' : 'ok', issues, watching: ['/storage/emulated/0/Download', '/storage/emulated/0/Documents', '/storage/emulated/0/Bluetooth'] };
}
function state() {
  return { product: product(), platform: 'android', settings, sig: { md5: 1898201, sha256: 2347, total: 1900548, created: NOW - 2 * 3600e3, bytes: 15204488, rules: 50, rulesVersion: '2026.11.1-m' },
    scan, lastScan: null, quarantine: { count: quar.length, bytes: quar.reduce((a, b) => a + b.size, 0) }, protection: prot(), nextScheduled: new Date(2026, 10, 5, 13, 0).getTime(), updating: false, elevated: perms.storage, perms, device: { model: 'Pixel 9', sdk: 36 } };
}
function product() { return { name: 'DT Kalkan', shortName: 'Kalkan', company: 'Development Turkey', appId: 'com.developmentturkey.dtkalkan', version: '1.0.0', year: 2026, website: 'https://developmentturkey.com', supportEmail: 'destek@developmentturkey.com', copyright: '© 2026 Development Turkey. Tüm hakları saklıdır.', copyrightEn: '© 2026 Development Turkey. All rights reserved.' }; }
const weather = { at: NOW, city: 'Batman', country: 'Türkiye', unit: 'c', temp: 14.2, feels: 12.6, code: 1, isDay: 1, wind: 9, humidity: 48, max: 17, min: 6 };

async function core(m, a) {
  switch (m) {
    case 'getState': return state();
    case 'setSettings': settings = merge(settings, a[0] || {}); setTimeout(() => emit('state', state()), 0); return settings;
    case 'resetSettings': return settings;
    case 'listHistory': return HISTORY;
    case 'clearHistory': return true;
    case 'getScan': return DOCS[a[0]] || (scan && scan.id === a[0] ? Object.assign({}, scan, { threatsList: scan._threats || [], items: [] }) : null);
    case 'listScans': return [];
    case 'listQuarantine': return quar;
    case 'getWeather': return SCN.noWeather ? null : weather;
    case 'systemInfo': return { os: 'Android 16 (API 36)', arch: 'arm64-v8a', cpus: 8, mem: 12 * 1073741824, host: 'Google Pixel 9', version: '1.0.0', elevated: perms.storage, workers: 2 };
    case 'sigInfo': return state().sig;
    case 'listApps': return APPS.filter(x => a[0] || true).map(x => ({ pkg: x[1], name: x[0], system: false, version: '3.' + (x[7] % 9) + '.' + x[7], size: x[6], splits: x[6] > 50e6 ? 3 : 1, installer: x[5] ? 'com.android.vending' : null, installedAt: NOW - x[7] * 86400e3, updatedAt: NOW - 86400e3, perms: x[7] + 3,
      lastVerdict: lastVerdict[x[1]] !== undefined ? lastVerdict[x[1]] : (x[1] === THREAT_PKG ? null : 'clean'), lastScore: 0, lastThreat: lastVerdict[x[1]] === 'malicious' ? 'Trojan-Banker.AndroidOS.Generic' : null }));
    case 'appIcons': { const o = {}; for (const p of a[0]) o[p] = ICONS[p] || null; return o; }
    case 'scanPaths': {
      const paths = a[0];
      const results = paths.map(p => p === 'app://' + THREAT_PKG ? threatApp : p.startsWith('app://') ? appItem(APPS.find(x => 'app://' + x[1] === p) || APPS[0])
        : byName(p.split('/').pop()) ? item(p.split('/').pop(), { path: p }) : { path: p, name: p.split('/').pop(), verdict: 'clean', score: 0, reasons: [] });
      const th = results.filter(r => r.verdict !== 'clean');
      const id = 'D' + Math.random().toString(36).slice(2, 7);
      DOCS[id] = { id, type: 'notch', status: 'done', startedAt: NOW, endedAt: NOW, scanned: results.length, threats: th.length, threatsList: th, items: results.filter(r => r.verdict === 'clean'), cleanCount: results.length - th.length, elapsed: 0, percent: 1 };
      await new Promise(r => setTimeout(r, 400));
      return { id, results, threats: th.length };
    }
    case 'applyAction': return { ok: true };
    case 'startScan': {
      const p = a[0] || {};
      scan = { id: 'Slive', type: p.type || 'quick', status: 'running', scanned: 0, discovered: 0, discoveryDone: false, threats: 0, current: '', elapsed: 0, startedAt: NOW, rate: 0, percent: 0 };
      setTimeout(() => emit('scan:start', scan), 10);
      return { id: 'Slive' };
    }
    case 'pauseScan': case 'resumeScan': case 'cancelScan': return true;
    case 'updateSignatures': return { ok: true };
    case 'removeAllow': return [];
    case 'restoreQuarantine': return { ok: true, restoredTo: DL + 'x' };
    case 'deleteQuarantine': case 'deleteAllQuarantine': return { ok: true };
    case 'knownFolders': return { downloads: DL };
    case 'appInfo': return null;
  }
  return null;
}
async function ui(m, p) {
  switch (m) {
    case 'app:info': return { product: product(), platform: 'android', version: '1.0.0', buildDate: '2026-11-04', sdk: 36 };
    case 'perm:status': return perms;
    case 'perm:request': await new Promise(r => setTimeout(r, 600)); perms[p.key] = true; return true;
    case 'toast:show': p.id = Date.now(); p.duration = p.duration || 6000; emit('toast', p); return null;
    case 'notch:geom': return Object.assign({ width: 412, height: 915, top: 32, cutoutH: 30, overlay: true }, window.__dtInsetsVal || {});
    case 'notch:size': if (window.__onNotchSize) window.__onNotchSize(p); return null;
    case 'haptic': return null;
  }
  return null;
}
window.DTNative = {
  post(id, kind, method, args) {
    const a = JSON.parse(args || '[]');
    (kind === 'core' ? core(method, a) : ui(method, a[0])).then(r => setTimeout(() => window.__dtRes(id, true, r === undefined ? null : JSON.parse(JSON.stringify(r))), 5), e => window.__dtRes(id, false, String(e)));
  },
  role() { return 'main'; }, insets() { return '{}'; },
};
window.addEventListener('DOMContentLoaded', () => {
  const ins = { top: 32, bottom: 18, left: 0, right: 0, width: 412, height: 915, cutout: { x: 206, w: 30, h: 30 }, cutoutH: 30 };
  setTimeout(() => window.__dtInsets && window.__dtInsets(ins), 0);
  if (SCN.lang) settings.lang = SCN.lang;
});
