'use strict';
// DT Kalkan detection core: combines signature, PE heuristics, rule engine and archive analysis.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parsePE, entropy } = require('./pe');
const { listEntries, readEntry } = require('./zip');

const HEAD_LIMIT = 48 * 1024 * 1024;     // bytes kept in memory for content analysis
const ENTRY_LIMIT = 24 * 1024 * 1024;    // per archive entry
const ARCHIVE_BUDGET = 160 * 1024 * 1024; // total uncompressed bytes per archive tree

const SCRIPT_EXT = new Set(['bat', 'cmd', 'ps1', 'psm1', 'psd1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'py', 'pyw', 'sh', 'php', 'reg', 'scf', 'inf', 'au3', 'ahk', 'lnk', 'url']);
const EXEC_EXT = new Set(['exe', 'dll', 'scr', 'com', 'pif', 'cpl', 'sys', 'ocx', 'msi', 'drv']);
const DOC_EXT = new Set(['pdf', 'doc', 'docx', 'docm', 'xls', 'xlsx', 'xlsm', 'ppt', 'pptx', 'pptm', 'rtf', 'txt', 'jpg', 'jpeg', 'png', 'gif', 'mp4', 'mp3', 'zip', 'rar']);
const SYSTEM_NAMES = new Set(['svchost.exe', 'explorer.exe', 'lsass.exe', 'csrss.exe', 'winlogon.exe', 'services.exe', 'smss.exe', 'spoolsv.exe', 'taskhost.exe', 'taskhostw.exe', 'dwm.exe', 'conhost.exe', 'rundll32.exe', 'wininit.exe', 'ctfmon.exe']);

const T = (tr, en) => ({ tr, en: en || tr });

function sniff(buf, name) {
  const ext = (path.extname(name).slice(1) || '').toLowerCase();
  const f = { is_pe: false, is_dll: false, is_script: false, is_text: false, is_office: false, is_dotnet: false, is_zip: false, is_lnk: false, is_signed: false };
  let kind = 'binary';
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) { kind = 'pe'; f.is_pe = true; }
  else if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) { kind = 'zip'; f.is_zip = true; }
  else if (buf.length >= 8 && buf.readUInt32BE(0) === 0xd0cf11e0 && buf.readUInt32BE(4) === 0xa1b11ae1) { kind = 'ole'; f.is_office = true; }
  else if (buf.length >= 8 && buf.readUInt32LE(0) === 0x4c && buf.readUInt32LE(4) === 0x00021401) { kind = 'lnk'; f.is_lnk = true; }
  else if (buf.length >= 5 && buf.toString('latin1', 0, 5) === '%PDF-') kind = 'pdf';
  else if (buf.length >= 5 && buf.toString('latin1', 0, 5) === '{\\rtf') { kind = 'rtf'; f.is_office = true; f.is_text = true; }
  if (kind === 'binary') {
    const n = Math.min(buf.length, 8192);
    let bad = 0;
    let start = 0;
    if (buf[0] === 0xff && buf[1] === 0xfe) { kind = 'text'; f.is_text = true; } // UTF-16 text
    else {
      if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) start = 3;
      for (let i = start; i < n; i++) { const c = buf[i]; if (c === 0 || (c < 9) || (c > 13 && c < 32 && c !== 27)) bad++; }
      if (n === 0 || bad / Math.max(1, n) < 0.02) { kind = 'text'; f.is_text = true; }
    }
  }
  if (SCRIPT_EXT.has(ext) && (f.is_text || f.is_lnk)) { f.is_script = true; if (kind === 'text') kind = 'script'; }
  // shebang / script-looking text without extension
  if (kind === 'text' && /^(#!|<\?php|@echo off|param\s*\(|<script|Set\s+\w+\s*=\s*CreateObject)/i.test(buf.toString('latin1', 0, 200).trimStart())) { f.is_script = true; kind = 'script'; }
  if (['docm', 'xlsm', 'pptm', 'doc', 'xls', 'ppt', 'dotm', 'xlam'].includes(ext)) f.is_office = f.is_office || kind === 'zip';
  return { ext, kind, flags: f };
}

// ───────── MS-OVBA (VBA source) decompression ─────────
function ovbaDecompress(buf, start, limit = 512 * 1024) {
  if (buf[start] !== 1) return null;
  const out = [];
  let p = start + 1;
  while (p + 2 <= buf.length && out.length < limit) {
    const header = buf.readUInt16LE(p);
    if (((header >> 12) & 7) !== 3) break;
    const chunkEnd = Math.min(buf.length, p + (header & 0x0fff) + 3);
    const compressed = (header >> 15) & 1;
    p += 2;
    const dStart = out.length;
    if (!compressed) { for (let i = 0; i < 4096 && p < buf.length; i++) out.push(buf[p++]); continue; }
    while (p < chunkEnd) {
      const flags = buf[p++];
      for (let bit = 0; bit < 8 && p < chunkEnd; bit++) {
        if (!((flags >> bit) & 1)) { out.push(buf[p++]); continue; }
        if (p + 2 > buf.length) { p = chunkEnd; break; }
        const token = buf.readUInt16LE(p); p += 2;
        const diff = out.length - dStart;
        let bc = 4; while ((1 << bc) < diff) bc++;
        const lengthMask = 0xffff >> bc;
        const len = (token & lengthMask) + 3;
        const off = (token >> (16 - bc)) + 1;
        const from = out.length - off;
        if (from < 0) return Buffer.from(out);
        for (let k = 0; k < len; k++) out.push(out[from + k]);
      }
    }
    p = chunkEnd;
  }
  return Buffer.from(out);
}

function extractVBA(buf) {
  const parts = [];
  const needle = Buffer.from('Attribut', 'latin1');
  let i = buf.indexOf(needle), total = 0, guard = 0;
  while (i !== -1 && guard++ < 200 && total < 2 * 1024 * 1024) {
    if (i >= 4 && buf[i - 4] === 1 && buf[i - 1] === 0) {
      const src = ovbaDecompress(buf, i - 4);
      if (src && src.length > 16 && /Attribute VB_/.test(src.toString('latin1', 0, 64))) { parts.push(src); total += src.length; }
    }
    i = buf.indexOf(needle, i + 8);
  }
  return parts.length ? Buffer.concat(parts) : null;
}

// ───────── PE heuristics ─────────
const PACKERS = [
  [/^UPX[0-9!]?$/i, 'UPX', 18], [/^\.aspack$|^\.adata$/i, 'ASPack', 28], [/^\.MPRESS[12]$/i, 'MPRESS', 28],
  [/^\.petite$/i, 'Petite', 28], [/^\.nsp[012]$/i, 'NsPack', 30], [/^\.themida$|^\.winlice$/i, 'Themida', 30],
  [/^\.vmp[0-9]$/i, 'VMProtect', 22], [/^\.enigma[12]$/i, 'Enigma', 25], [/^\.pec2?$|^PEC2$/i, 'PECompact', 28],
  [/^\.yP$|^\.y0da$/i, 'Yoda', 35], [/^\.MEW$|^MEW$/i, 'MEW', 35], [/^\.perplex$/i, 'Perplex', 35], [/^\.packed$/i, 'Generic', 30],
];

function peHeuristics(pe, buf, name, fullSize, filePath) {
  const R = [];
  const add = (w, code, tr, en, tname) => R.push({ layer: 'heuristic', code, weight: w, t: T(tr, en), tname });
  if (!pe.valid) return R;
  const imp = pe.importSet;
  const has = (...fs) => fs.some(f => imp.has(f.toLowerCase()));
  // packers
  const seenPk = new Set();
  for (const s of pe.sections) for (const [re, pk, w] of PACKERS) {
    if (re.test(s.name) && !seenPk.has(pk)) { seenPk.add(pk); add(w, 'packer', `Paketleyici bölümü tespit edildi: ${pk} (${s.name})`, `Packer section detected: ${pk} (${s.name})`, `Packed.Win32.${pk}`); break; }
  }
  // entropy
  const execSecs = pe.sections.filter(s => s.exec && s.rawSize > 512);
  const hiExec = execSecs.filter(s => s.entropy > 7.2);
  if (hiExec.length) add(20, 'entropy', `Yüksek entropili kod bölümü (${hiExec[0].name || '?'}: ${hiExec[0].entropy.toFixed(2)}) — şifrelenmiş/paketlenmiş olabilir`, `High-entropy code section (${hiExec[0].name || '?'}: ${hiExec[0].entropy.toFixed(2)}) — likely packed/encrypted`, 'Packed.Win32.Generic');
  const raw = pe.sections.reduce((a, s) => a + s.rawSize, 0);
  const hiAll = pe.sections.filter(s => s.entropy > 7.0).reduce((a, s) => a + s.rawSize, 0);
  if (raw > 4096 && hiAll / raw > 0.8 && !hiExec.length) add(10, 'entropy-all', 'Dosyanın büyük bölümü sıkıştırılmış/şifrelenmiş veri', 'Most of the file is compressed/encrypted data');
  // entry point
  if (!pe.entrySection && pe.entryRva) add(22, 'ep-outside', 'Giriş noktası hiçbir bölümün içinde değil', 'Entry point lies outside all sections', 'Trojan.Win32.Generic');
  else if (pe.entrySection && !pe.entrySection.exec) add(20, 'ep-nonexec', `Giriş noktası çalıştırılamaz bölümde (${pe.entrySection.name})`, `Entry point in non-executable section (${pe.entrySection.name})`, 'Trojan.Win32.Generic');
  else if (pe.entrySection && pe.sections.length > 2 && pe.entrySection === pe.sections[pe.sections.length - 1] && pe.entrySection.write) add(14, 'ep-last', 'Giriş noktası son ve yazılabilir bölümde (paketleyici izi)', 'Entry point in last writable section (packer trait)');
  const wx = pe.sections.filter(s => s.exec && s.write);
  if (wx.length) add(8, 'wx', `Hem yazılabilir hem çalıştırılabilir bölüm (${wx[0].name})`, `Writable and executable section (${wx[0].name})`);
  // imports
  if (has('VirtualAllocEx', 'NtAllocateVirtualMemory', 'ZwAllocateVirtualMemory') && has('WriteProcessMemory', 'NtWriteVirtualMemory') && has('CreateRemoteThread', 'CreateRemoteThreadEx', 'NtCreateThreadEx', 'RtlCreateUserThread', 'QueueUserAPC', 'SetThreadContext'))
    add(pe.isDll ? 20 : 35, 'inject', 'Süreç enjeksiyonu API zinciri (VirtualAllocEx → WriteProcessMemory → CreateRemoteThread)', 'Process injection API chain (VirtualAllocEx → WriteProcessMemory → CreateRemoteThread)', 'Trojan.Win32.Injector.Gen');
  if (has('NtUnmapViewOfSection', 'ZwUnmapViewOfSection') && has('SetThreadContext', 'Wow64SetThreadContext') && has('ResumeThread'))
    add(30, 'hollow', 'Süreç boşaltma (process hollowing) API dizisi', 'Process hollowing API sequence', 'Trojan.Win32.Hollow.Gen');
  if (has('SetWindowsHookEx') && has('GetAsyncKeyState', 'GetKeyState', 'GetKeyboardState') && has('GetForegroundWindow'))
    add(22, 'keylog', 'Klavye kancası + tuş durumu okuma (keylogger davranışı)', 'Keyboard hook + key state polling (keylogger behaviour)', 'Spyware.Win32.Keylogger.Gen');
  else if (has('GetAsyncKeyState') && has('GetForegroundWindow') && has('GetWindowText'))
    add(10, 'keypoll', 'Tuş durumu ve etkin pencere başlığı takibi', 'Polls keys and active window title');
  if (has('URLDownloadToFile', 'URLDownloadToCacheFile') && has('WinExec', 'ShellExecute', 'ShellExecuteEx', 'CreateProcess'))
    add(20, 'download-exec', 'İnternetten dosya indirip çalıştırma (URLDownloadToFile + çalıştırma)', 'Downloads and executes files (URLDownloadToFile + exec)', 'Trojan-Downloader.Win32.Agent');
  if (has('IsDebuggerPresent') && has('CheckRemoteDebuggerPresent') && has('NtQueryInformationProcess', 'OutputDebugString'))
    add(6, 'antidebug', 'Hata ayıklayıcı algılama teknikleri', 'Anti-debugging techniques');
  if (has('AdjustTokenPrivileges') && has('OpenProcess') && has('MiniDumpWriteDump'))
    add(30, 'lsass-dump', 'Bellek dökümü + yetki yükseltme (kimlik bilgisi çalma aracı izi)', 'Memory dump + privilege adjust (credential dumping)', 'HackTool.Win32.CredDump');
  if (has('CryptEncrypt', 'BCryptEncrypt') && has('FindFirstFile', 'FindFirstFileEx') && has('MoveFileEx', 'MoveFile') && has('GetLogicalDrives', 'GetDriveType'))
    add(18, 'ransom-api', 'Sürücü tarama + toplu şifreleme API kombinasyonu', 'Drive enumeration + bulk encryption API combination', 'Trojan-Ransom.Win32.Gen');
  const dlls = Object.keys(pe.imports);
  if (!pe.isDotNet && pe.importCount > 0 && pe.importCount < 6 && has('GetProcAddress') && has('LoadLibrary', 'LoadLibraryEx'))
    add(15, 'few-imports', `Çok az içe aktarım (${pe.importCount}) — çalışma anında API çözümleme`, `Very few imports (${pe.importCount}) — resolves APIs at runtime`, 'Packed.Win32.Generic');
  if (!pe.isDotNet && !dlls.length && !pe.isDll && pe.sections.length) add(14, 'no-imports', 'İçe aktarım tablosu yok', 'No import table');
  // TLS
  if (pe.tlsCallbacks > 0) add(8, 'tls', `TLS geri çağrıları (${pe.tlsCallbacks}) — giriş noktasından önce kod çalıştırma`, `TLS callbacks (${pe.tlsCallbacks}) — code runs before entry point`);
  // overlay
  if (pe.overlaySize > 64 * 1024 && pe.overlaySize / fullSize > 0.4 && pe.overlayEntropy > 7.5 && !pe.signed && !pe.hasVersionInfo)
    add(12, 'overlay', `Büyük şifreli ek veri (overlay ${(pe.overlaySize / 1048576).toFixed(1)} MB)`, `Large encrypted overlay (${(pe.overlaySize / 1048576).toFixed(1)} MB)`);
  // version info
  const base = path.basename(name).toLowerCase();
  if (!pe.hasVersionInfo && !pe.isDll && pe.subsystem === 2) add(5, 'no-version', 'Sürüm bilgisi (yayıncı/ürün) yok', 'Missing version information');
  const orig = (pe.version.OriginalFilename || '').toLowerCase().replace(/\.mui$/, '');
  if (orig && SYSTEM_NAMES.has(orig) && !/\\windows\\(system32|syswow64)\\/i.test(filePath || '') && orig !== base)
    add(35, 'masquerade', `Windows sistem dosyası gibi davranıyor (${pe.version.OriginalFilename}) ama yeri/adı farklı`, `Masquerades as a Windows system file (${pe.version.OriginalFilename})`, 'Trojan.Win32.Masquerade');
  if (SYSTEM_NAMES.has(base) && filePath && !/\\windows\\/i.test(filePath) && /^[a-z]:\\/i.test(filePath))
    add(30, 'sysname', `Sistem dosyası adıyla Windows klasörü dışında (${base})`, `System file name outside Windows folder (${base})`, 'Trojan.Win32.Masquerade');
  const ts = pe.timestamp * 1000;
  if (pe.timestamp && ts > Date.now() + 86400000 * 30 && ts < Date.now() + 86400000 * 365 * 20) add(4, 'future-ts', 'Derleme zamanı gelecekte', 'Compile timestamp in the future');
  if (pe.parseError) add(10, 'malformed', 'Bozuk/kasıtlı olarak hatalı PE başlıkları', 'Malformed PE headers');
  return R;
}

function nameHeuristics(name) {
  const R = [];
  const base = path.basename(name);
  const lower = base.toLowerCase();
  if (/\u202e/.test(base)) R.push({ layer: 'heuristic', code: 'rtlo', weight: 45, t: T('Dosya adında yön değiştirme (RTLO) karakteri — uzantı gizleme', 'Right-to-left override in file name — hides extension'), tname: 'Trojan.Win32.Masquerade' });
  const m = lower.match(/\.([a-z0-9]{2,4})\s*\.([a-z0-9]{2,4})$/);
  if (m && DOC_EXT.has(m[1]) && (EXEC_EXT.has(m[2]) || ['bat', 'cmd', 'vbs', 'js', 'ps1', 'hta', 'lnk', 'scr'].includes(m[2])))
    R.push({ layer: 'heuristic', code: 'double-ext', weight: 35, t: T(`Çift uzantı ile gizlenmiş çalıştırılabilir dosya (.${m[1]}.${m[2]})`, `Executable hidden behind double extension (.${m[1]}.${m[2]})`), tname: 'Trojan.Win32.Masquerade' });
  if (/\s{6,}\.(exe|scr|com|bat)$/i.test(base)) R.push({ layer: 'heuristic', code: 'space-pad', weight: 25, t: T('Uzantıyı gizlemek için çok sayıda boşluk', 'Many spaces used to hide the extension') });
  return R;
}

// ───────── combination ─────────
const SENS = { low: { mul: 0.75, susp: 50 }, normal: { mul: 1, susp: 40 }, high: { mul: 1.3, susp: 30 } };

function combine(reasons, sens = 'normal') {
  const S = SENS[sens] || SENS.normal;
  let sig = 0, rule = 0, ruleRest = 0, heur = 0, sub = 0;
  let best = null;
  for (const r of reasons) {
    if (r.layer === 'signature') sig = 100;
    else if (r.layer === 'rule') { if (r.weight > rule) { ruleRest += rule; rule = r.weight; } else ruleRest += r.weight; }
    else if (r.layer === 'heuristic') heur += r.weight;
    else if (r.layer === 'archive' || r.layer === 'decoded') sub = Math.max(sub, r.weight);
    else if (r.layer === 'trust') heur += r.weight; // negative
  }
  heur = Math.max(0, Math.min(85, heur * S.mul));
  rule = Math.min(100, rule + ruleRest * 0.1);
  const hi = Math.max(rule, heur), lo = Math.min(rule, heur);
  let score = Math.round(Math.min(100, Math.max(sig, sub, hi + lo * 0.35)));
  const verdict = score >= 70 ? 'malicious' : score >= S.susp ? 'suspicious' : 'clean';
  // name: signature > archive child > strongest rule > strongest named heuristic
  const named = reasons.filter(r => r.tname);
  if (named.length) {
    const order = { signature: 4, archive: 3, decoded: 3, rule: 2, heuristic: 1 };
    named.sort((a, b) => (order[b.layer] - order[a.layer]) || (b.weight - a.weight));
    best = named[0];
  }
  let threat = null;
  if (verdict !== 'clean') {
    threat = best ? best.tname : 'Trojan.Generic';
    const onlyHeur = !reasons.some(r => r.layer === 'signature' || r.layer === 'rule' || r.layer === 'archive' || r.layer === 'decoded');
    if (onlyHeur && !threat.startsWith('HEUR:')) threat = 'HEUR:' + threat;
  }
  return { score, verdict, threat };
}

/**
 * Analyse an in-memory buffer.
 * ctx: { sigdb, rules, settings:{heuristics, archiveDepth}, budget:{bytes} }
 */
function analyzeBuffer(buf, name, ctx, depth = 0, hashes = null, fullSize = buf.length, filePath = null) {
  const reasons = [];
  const info = sniff(buf, name);
  const layers = { signature: false, heuristic: false, rules: false, archive: false };
  const s = ctx.settings || {};

  // 1) signatures
  const md5 = hashes ? hashes.md5 : crypto.createHash('md5').update(buf).digest('hex');
  const sha256 = hashes ? hashes.sha256 : crypto.createHash('sha256').update(buf).digest('hex');
  if (ctx.sigdb) {
    layers.signature = true;
    const hit = ctx.sigdb.lookup(md5, sha256);
    if (hit.hit) {
      const fam = hit.name || (info.flags.is_pe ? 'Trojan.Win32.Generic.Sig' : info.flags.is_script ? 'Trojan.Script.Generic.Sig' : 'Malware.Generic.Sig');
      reasons.push({ layer: 'signature', code: 'hash', weight: 100, t: T(`Bilinen zararlı yazılım imzası eşleşti (SHA-256/MD5)${hit.test ? ' — test dosyası' : ''}`, `Known malware signature matched (SHA-256/MD5)${hit.test ? ' — test file' : ''}`), tname: fam });
    }
  }
  if (ctx.allow && ctx.allow.has(sha256)) {
    return { md5, sha256, kind: info.kind, score: 0, verdict: 'clean', threat: null, reasons: [{ layer: 'trust', code: 'allow', weight: 0, t: T('Kullanıcı tarafından güvenilir olarak işaretlendi', 'Marked as trusted by the user') }], layers, allowed: true };
  }

  // 2) PE heuristics
  let pe = null;
  if (info.flags.is_pe && s.heuristicsEnabled !== false) {
    layers.heuristic = true;
    pe = parsePE(buf);
    if (pe.valid) {
      info.flags.is_dll = pe.isDll;
      info.flags.is_dotnet = pe.isDotNet;
      info.flags.is_signed = pe.signed;
      reasons.push(...peHeuristics(pe, buf, name, fullSize, filePath));
      if (pe.signed && reasons.some(r => r.layer === 'heuristic')) reasons.push({ layer: 'trust', code: 'signed', weight: -15, t: T('Dijital imza bloğu mevcut (puan düşürüldü)', 'Has a digital signature block (score reduced)') });
      if (['scr', 'pif', 'com'].includes(info.ext)) reasons.push({ layer: 'heuristic', code: 'rare-ext', weight: 10, t: T(`Nadir çalıştırılabilir uzantısı (.${info.ext})`, `Unusual executable extension (.${info.ext})`) });
    } else if (EXEC_EXT.has(info.ext) && buf.length > 64) {
      reasons.push({ layer: 'heuristic', code: 'bad-pe', weight: 10, t: T('Geçersiz/bozuk çalıştırılabilir dosya yapısı', 'Invalid/corrupt executable structure') });
    }
  }
  if (s.heuristicsEnabled !== false) {
    const nh = nameHeuristics(name);
    if (nh.length) { layers.heuristic = true; reasons.push(...nh); }
    // non-PE content but executable extension → disguised
    if (!info.flags.is_pe && ['exe', 'scr', 'dll'].includes(info.ext) && info.kind === 'script') reasons.push({ layer: 'heuristic', code: 'fake-exe', weight: 15, t: T('Çalıştırılabilir uzantılı ama betik içeriği', 'Executable extension but script content') });
  }

  // 3) rules
  if (ctx.rules) {
    layers.rules = true;
    let content = buf;
    if (info.kind === 'text' && buf[0] === 0xff && buf[1] === 0xfe) content = Buffer.from(buf.toString('utf16le'), 'latin1');
    let extra = null;
    if (info.kind === 'ole' || (info.flags.is_office && info.kind !== 'zip')) { const v = extractVBA(buf); if (v) { extra = v; layers.archive = true; } }
    const target = extra ? Buffer.concat([content, Buffer.from('\n'), extra]) : content;
    const hits = ctx.rules.match(target, { size: fullSize, ext: info.ext, flags: info.flags });
    for (const h of hits) reasons.push({ layer: 'rule', code: h.id, weight: h.score, t: T(h.desc || h.id), tname: h.name, matched: h.matched });

    // decode PowerShell -EncodedCommand payloads and rescan them
    if ((info.flags.is_script || info.flags.is_text || info.flags.is_lnk) && depth < 3) {
      const str = target.toString('latin1');
      const re = /-e(?:nc(?:odedcommand)?|c)?\s+([A-Za-z0-9+/]{40,}={0,2})/gi;
      let m, n = 0;
      while ((m = re.exec(str)) && n++ < 4) {
        try {
          const dec = Buffer.from(m[1], 'base64').toString('utf16le');
          if (/[a-z]{3}/i.test(dec)) {
            const sub = analyzeBuffer(Buffer.from(dec, 'latin1'), 'decoded.ps1', ctx, depth + 1);
            if (sub.verdict !== 'clean') reasons.push({ layer: 'decoded', code: 'ps-enc', weight: sub.score, t: T(`Çözülmüş gizli PowerShell yükü: ${sub.threat}`, `Decoded hidden PowerShell payload: ${sub.threat}`), tname: sub.threat });
            else reasons.push({ layer: 'heuristic', code: 'ps-enc-clean', weight: 10, t: T('Gizlenmiş PowerShell komutu (çözüldü, belirgin zararlı içerik yok)', 'Encoded PowerShell command (decoded, nothing overtly malicious)') });
          }
        } catch { /* ignore */ }
      }
    }
  }

  // 4) archives
  const children = [];
  if (info.kind === 'zip' && depth < (s.archiveDepth ?? 2) + 1) {
    layers.archive = true;
    const entries = listEntries(buf, 3000);
    const budget = ctx.budget || (ctx.budget = { bytes: ARCHIVE_BUDGET });
    const enc = entries.filter(e => e.encrypted && !e.dir);
    const vba = entries.find(e => /vbaProject\.bin$/i.test(e.name));
    for (const e of entries) {
      if (e.dir || e.encrypted || budget.bytes <= 0) continue;
      if (e.usize > ENTRY_LIMIT * 4) continue;
      const lname = e.name.toLowerCase();
      // OOXML: skip media, scan code-bearing parts only
      if (/\.(png|jpe?g|gif|emf|wmf|ttf|otf|woff2?|mp3|mp4)$/.test(lname)) continue;
      const data = readEntry(buf, e, ENTRY_LIMIT);
      if (!data) continue;
      budget.bytes -= data.length;
      const sub = analyzeBuffer(data, e.name, Object.assign({}, ctx, { settings: s }), depth + 1, null, data.length, null);
      if (/vbaProject\.bin$/i.test(e.name)) {
        const v = extractVBA(data);
        if (v && ctx.rules) {
          const hits = ctx.rules.match(Buffer.concat([data, v]), { size: data.length, ext: 'bin', flags: Object.assign({}, info.flags, { is_office: true }) });
          for (const h of hits) reasons.push({ layer: 'rule', code: h.id, weight: h.score, t: T(h.desc || h.id), tname: h.name, matched: h.matched });
        }
      }
      if (sub.verdict !== 'clean') {
        children.push({ name: e.name, verdict: sub.verdict, threat: sub.threat, score: sub.score });
        reasons.push({ layer: 'archive', code: 'child', weight: sub.score, t: T(`Arşiv içinde: ${e.name} → ${sub.threat}`, `Inside archive: ${e.name} → ${sub.threat}`), tname: sub.threat });
      }
    }
    if (enc.length && enc.some(e => /\.(exe|scr|js|vbs|bat|ps1|lnk|hta|dll)$/i.test(e.name)))
      reasons.push({ layer: 'heuristic', code: 'enc-archive', weight: 30, t: T('Parola korumalı arşivde çalıştırılabilir dosya (taramadan kaçma yöntemi)', 'Password-protected archive containing executables (scan evasion)'), tname: 'Trojan.Archive.Encrypted' });
    if (vba) info.flags.is_office = true;
  }

  const res = combine(reasons, s.heuristics);
  return { md5, sha256, kind: info.kind, ext: info.ext, flags: info.flags, ...res, reasons, layers, children };
}

/** Streaming hash + analysis of a file on disk. */
function scanFile(filePath, ctx) {
  return new Promise((resolve) => {
    let st;
    try { st = fs.statSync(filePath); } catch (e) { return resolve({ path: filePath, error: e.code || String(e) }); }
    if (!st.isFile()) return resolve({ path: filePath, error: 'NOTFILE' });
    const maxMB = (ctx.settings && ctx.settings.maxFileMB) || 0;
    const md5 = crypto.createHash('md5'), sha = crypto.createHash('sha256');
    const keep = [];
    let kept = 0;
    const limit = Math.min(HEAD_LIMIT, maxMB ? maxMB * 1048576 : HEAD_LIMIT);
    const stream = fs.createReadStream(filePath, { highWaterMark: 1 << 20 });
    stream.on('data', (chunk) => {
      md5.update(chunk); sha.update(chunk);
      if (kept < limit) { const part = chunk.subarray(0, Math.min(chunk.length, limit - kept)); keep.push(Buffer.from(part)); kept += part.length; }
    });
    stream.on('error', (e) => resolve({ path: filePath, size: st.size, error: e.code || String(e) }));
    stream.on('end', () => {
      const hashes = { md5: md5.digest('hex'), sha256: sha.digest('hex') };
      try {
        const buf = Buffer.concat(keep, kept);
        const r = analyzeBuffer(buf, path.basename(filePath), Object.assign({ budget: { bytes: ARCHIVE_BUDGET } }, ctx), 0, hashes, st.size, filePath);
        resolve({ path: filePath, name: path.basename(filePath), size: st.size, mtime: st.mtimeMs, truncated: st.size > kept, ...r });
      } catch (e) {
        resolve({ path: filePath, size: st.size, ...hashes, error: 'ANALYSIS:' + (e && e.message) });
      }
    });
  });
}

module.exports = { analyzeBuffer, scanFile, sniff, combine, extractVBA, ovbaDecompress, SCRIPT_EXT, EXEC_EXT };
