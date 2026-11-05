'use strict';
// Windows only: the main executable runs elevated (requireAdministrator). Windows blocks drag & drop
// from Explorer into elevated windows (UIPI), so the windows live in a sibling, non-elevated copy of the
// executable whose manifest asks for asInvoker. It is launched through Explorer so it gets the user's
// normal (medium integrity) token, and talks to the core over a local pipe.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const PRODUCT = require('../config/product');

function uiExePath(execPath) { return path.join(path.dirname(execPath), PRODUCT.notchExecutableName + '.exe'); }

function patchManifest(buf) {
  let count = 0;
  for (const q of ['"', "'"]) {
    const from = Buffer.from(`level=${q}requireAdministrator${q}`, 'utf8');
    const to = Buffer.from(`level=${q}asInvoker${q}`.padEnd(from.length, ' '), 'utf8');
    let i = buf.indexOf(from);
    while (i !== -1) { to.copy(buf, i); count++; i = buf.indexOf(from, i + from.length); }
    // UTF-16 manifests (rare)
    const from16 = Buffer.from(`level=${q}requireAdministrator${q}`, 'utf16le');
    const to16 = Buffer.from(`level=${q}asInvoker${q}`.padEnd(from.length, ' '), 'utf16le');
    i = buf.indexOf(from16);
    while (i !== -1) { to16.copy(buf, i); count++; i = buf.indexOf(from16, i + from16.length); }
  }
  return count;
}

/** Creates/refreshes the asInvoker copy next to the main exe. Returns its path or null. */
function ensureUiExe(execPath, log) {
  const dst = uiExePath(execPath);
  try {
    const src = fs.statSync(execPath);
    const marker = dst + '.ver';
    const want = `${PRODUCT.version}|${src.size}|${Math.floor(src.mtimeMs)}`;
    let have = '';
    try { have = fs.readFileSync(marker, 'utf8'); } catch { }
    if (have === want && fs.existsSync(dst)) return dst;
    const buf = fs.readFileSync(execPath);
    const n = patchManifest(buf);
    if (!n) { log && log('manifest patch: pattern not found'); }
    const tmp = dst + '.tmp';
    fs.writeFileSync(tmp, buf);
    try { fs.unlinkSync(dst); } catch { }
    fs.renameSync(tmp, dst);
    fs.writeFileSync(marker, want);
    try { require('child_process').execFileSync('attrib', ['+h', marker], { windowsHide: true }); } catch { }
    return dst;
  } catch (e) { log && log('ensureUiExe failed: ' + e.message); return null; }
}

/** Launches the UI exe with the desktop user's token (via the shell). */
function launchUnelevated(exe) {
  try {
    const c = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'), [exe], { detached: true, stdio: 'ignore', windowsHide: false });
    c.unref();
    return true;
  } catch { return false; }
}

module.exports = { ensureUiExe, launchUnelevated, uiExePath, patchManifest };
