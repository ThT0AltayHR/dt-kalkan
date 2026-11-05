'use strict';
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const PRODUCT = require('../config/product');

app.setName(PRODUCT.name);
if (process.platform === 'win32') app.setAppUserModelId(PRODUCT.appId);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const argv = process.argv.slice(1);
const flag = (n) => argv.some(a => a === n || a.startsWith(n + '='));
const flagVal = (n) => { const a = argv.find(x => x.startsWith(n + '=')); return a ? a.slice(n.length + 1) : null; };
const exeBase = path.basename(process.execPath, path.extname(process.execPath));
const IS_WIN = process.platform === 'win32';

// roles: 'all' (single process), 'core' (elevated protection core, Windows), 'ui' (non-elevated windows)
let role = 'all';
if (exeBase === PRODUCT.notchExecutableName || flag('--ui-process')) role = 'ui';
else if ((IS_WIN && app.isPackaged && !flag('--single')) || flag('--split')) role = 'core';

const baseUserData = path.join(app.getPath('appData'), PRODUCT.name);
app.setPath('userData', role === 'ui' ? path.join(baseUserData, 'UI') : baseUserData);
const startHidden = flag('--hidden');

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.whenReady().then(() => (role === 'ui' ? startUi() : role === 'core' ? startCore() : startAll()));
}

function makeCore() {
  const { Core } = require('./core');
  return new Core({ userData: baseUserData, appRoot: app.getAppPath(), execPath: process.execPath }).init();
}

function startAll(existingCore) {
  const core = existingCore || makeCore();
  const { UiHost } = require('./ui');
  const host = new UiHost(core, { startHidden, inProcess: true, onQuit: () => { core.shutdown(); app.exit(0); } });
  host.start();
  app.on('second-instance', () => host.showMain());
  app.on('window-all-closed', (e) => { /* keep running in tray */ });
  app.on('before-quit', () => { try { core.shutdown(); } catch { } });
  const cap = flagVal('--capture-script');
  if (cap) setTimeout(() => require(cap)(host, core, { outDir: flagVal('--capture-out') }), 500);
  return host;
}

function startCore() {
  const core = makeCore();
  const { serveCore } = require('./rpc');
  const split = require('./winsplit');
  let fallback = null;
  let relaunches = 0;
  let quitting = false;
  const toFallback = () => { if (fallback || quitting) return; core.log('UI process unavailable — running windows in-process'); fallback = startAll(core); };
  const launch = () => {
    if (IS_WIN && app.isPackaged) {
      const exe = split.ensureUiExe(process.execPath, (m) => core.log(m));
      if (!exe || !split.launchUnelevated(exe)) return toFallback();
    } else {
      const { spawn } = require('child_process');
      spawn(process.execPath, [app.getAppPath(), '--ui-process', '--no-sandbox'], { stdio: 'inherit', detached: false });
    }
  };
  const onCommand = (name) => {
    if (name === 'quit') { quitting = true; core.shutdown(); setTimeout(() => app.exit(0), 150); }
  };
  let serving = null;
  let first = true;
  const serve = () => {
    const c = serveCore(core, { maxWaitMs: first ? 25000 : 20000, onCommand });
    const hidden = first ? startHidden : true;
    first = false;
    c.on('connected', () => { c.command('boot', { hidden }); setTimeout(() => { relaunches = 0; }, 60000); });
    c.on('failed', toFallback);
    c.on('disconnected', () => {
      if (quitting || fallback) return;
      if (++relaunches > 3) return toFallback();
      setTimeout(() => { serve(); launch(); }, 1500);
    });
    serving = c;
  };
  serve();
  launch();
  app.on('second-instance', () => { if (fallback) fallback.showMain(); else serving.command('show'); });
  app.on('window-all-closed', () => {});
}

async function startUi() {
  const { Core } = require('./core');
  const { CoreProxy } = require('./rpc');
  const proxy = new CoreProxy(Core.RPC_METHODS);
  try { await proxy.listen(); } catch (e) { app.exit(1); return; }
  const ok = await proxy.waitConnected(30000);
  if (!ok) { app.exit(1); return; }
  const boot = await new Promise((res) => { const t = setTimeout(() => res({}), 1500); proxy.once('command', (n, d) => { if (n === 'boot') { clearTimeout(t); res(d || {}); } }); });
  const { UiHost } = require('./ui');
  const host = new UiHost(proxy, { startHidden: !!boot.hidden, inProcess: false, onQuit: () => { proxy.command('quit'); setTimeout(() => app.exit(0), 300); } });
  host.start();
  proxy.on('command', (n) => { if (n === 'show') host.showMain(); });
  proxy.on('disconnected', () => setTimeout(() => app.exit(0), 200));
  app.on('second-instance', () => host.showMain());
  app.on('window-all-closed', () => {});
}

process.on('uncaughtException', (e) => { try { fs.appendFileSync(path.join(baseUserData, 'logs', 'crash.log'), `[${new Date().toISOString()}] ${role} ${e.stack || e}\n`); } catch { } });
