// Product screenshot / GIF frame capture. Run with:  electron . --capture-script=<this file> --capture-out=<dir>
// Not packaged with the app.
const { BrowserWindow, app } = require('electron');
const fs = require('fs'), path = require('path');

module.exports = async (host, core, { outDir }) => {
  const OUT = outDir || '/tmp/cap/out';
  const SHOTS = path.join(OUT, 'shots'), FR = path.join(OUT, 'frames');
  fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(FR, { recursive: true });
  const meta = { shots: {}, seqs: {} };
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const js = (w, c) => w.webContents.executeJavaScript(c, true);
  const only = (process.env.CAP_ONLY || '').split(',').filter(Boolean);
  const want = (k) => !only.length || only.includes(k);
  const log = (...a) => console.log('[cap]', ...a);
  async function shot(win, name) {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(SHOTS, name + '.png'), img.toPNG());
    meta.shots[name] = { bounds: win.getBounds(), kind: win === host.notch ? 'notch' : win === host.toast ? 'toast' : 'main' };
    log('shot', name);
  }
  async function framesSub(win, name, ms, during) {
    const dir = path.join(FR, name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const list = []; let i = 0; const t0 = Date.now(); let last = -1;
    const imgs = [];
    win.webContents.beginFrameSubscription(false, (img) => { const ts = Date.now() - t0; if (ts - last < 40) return; last = ts; imgs.push({ ts, png: img.toPNG() }); });
    win.webContents.invalidate();
    const p = during ? during() : null;
    await wait(ms);
    win.webContents.endFrameSubscription();
    if (p) await p;
    for (const f of imgs) { const fn = String(i++).padStart(4, '0') + '.png'; fs.writeFileSync(path.join(dir, fn), f.png); list.push({ f: fn, ts: f.ts, b: win.getBounds() }); }
    meta.seqs[name] = { kind: 'main', frames: list };
    log('framesSub', name, list.length);
  }
  async function frames(win, name, ms, during) {
    const dir = path.join(FR, name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const list = [];
    const t0 = Date.now(); let i = 0;
    const p = during ? during() : null;
    while (Date.now() - t0 < ms) {
      const ts = Date.now() - t0;
      const b = win.getBounds();
      const img = await win.webContents.capturePage();
      const f = String(i++).padStart(4, '0') + '.png';
      fs.writeFileSync(path.join(dir, f), img.toPNG());
      list.push({ f, ts, b });
      const el = Date.now() - t0 - ts; if (el < 55) await wait(55 - el);
    }
    if (p) await p;
    meta.seqs[name] = { kind: win === host.notch ? 'notch' : win === host.toast ? 'toast' : 'main', frames: list };
    log('frames', name, list.length);
  }
  const MF = path.join(OUT, 'meta.json');
  try { Object.assign(meta, JSON.parse(fs.readFileSync(MF, 'utf8'))); } catch { }
  const save = () => fs.writeFileSync(MF, JSON.stringify(meta, null, 1));
  const PH = process.env.CAP_PHASE || 'A';
  const M = () => host.main;

  try {
    const N = () => host.notch;
    if (PH === 'I') {
    // ── intro ──
    await new Promise(r => { if (M().webContents.isLoading()) M().webContents.once('did-finish-load', r); else r(); });
    await wait(6800); // let the live intro finish, then replay it in slow motion for capture
    const SL = 5;
    const dbg = M().webContents.debugger; dbg.attach('1.3'); await dbg.sendCommand('Animation.enable'); await dbg.sendCommand('Animation.setPlaybackRate', { playbackRate: 1 / SL });
    await js(M(), `(()=>{window.__pn=performance.now;const o=performance.now.bind(performance),t0=o();performance.now=()=>t0+(o()-t0)/${SL};const st=window.setTimeout.bind(window);window.__st=window.setTimeout;window.setTimeout=(f,d,...a)=>st(f,(d||0)*${SL},...a);document.getElementById('bg').style.display='none';Onboarding.playIntro();})()`);
    await framesSub(M(), 'intro', 4500 * SL, async () => { await wait(2700 * SL); await shot(M(), '01-splash'); });
    meta.seqs.intro.frames.forEach(f => f.ts = Math.round(f.ts / SL));
    await js(M(), `window.setTimeout=window.__st;document.getElementById('bg').style.display=''`);
    await dbg.sendCommand('Animation.setPlaybackRate', { playbackRate: 1 }); dbg.detach();
    await js(M(), `performance.now=window.__pn;0`);
    save();
    }
    if (PH === 'A') {
    await new Promise(r => { if (M().webContents.isLoading()) M().webContents.once('did-finish-load', r); else r(); });
    await wait(4800);
    await js(M(), `Onboarding.eula=true;document.querySelector('#obEula .check').classList.add('on');document.querySelector('#obStart').disabled=false;`);
    await wait(300);
    await shot(M(), '02-welcome');
    const perms = ['realtime', 'startup', 'notifications', 'location', 'background'];
    await js(M(), `Onboarding.goto(1)`); await wait(1100);
    for (let k = 0; k < perms.length; k++) {
      await shot(M(), `03-permission-${k + 1}-${perms[k]}`);
      await js(M(), `Onboarding.decide('${perms[k]}', true)`);
      if (perms[k] === 'notifications') { await wait(1100); await shot(host.toast, '30-toast-preview'); }
      await wait(perms[k] === 'location' ? 3200 : 2000);
    }
    await wait(800);
    await shot(M(), '04-onboarding-done');
    await js(M(), `Onboarding.finish()`);
    await wait(2500);
    save();

    // ── notch idle / hover ──
    await wait(1500);
    await shot(N(), '20-notch-idle');
    await js(N(), 'NotchDemo.hover()'); await wait(1100);
    await shot(N(), '21-notch-expanded');
    await frames(N(), 'notch-hover', 2200, async () => { await js(N(), 'NotchDemo.idle()'); await wait(900); await js(N(), 'NotchDemo.hover()'); });
    await js(N(), 'NotchDemo.idle()'); await wait(1200);
    save();

    // ── notch drop: clean ──
    await frames(N(), 'notch-drop-clean', 7600, async () => {
      await wait(300);
      await js(N(), `NotchDemo.drop(['/tmp/dtenv/clean/notlar.txt'], 300, 70)`);
      await wait(700); await shot(N(), '22-notch-drop-open');
      await wait(1500); await shot(N(), '23-notch-drop-scanning');
      await wait(900); await shot(N(), '24-notch-drop-clean');
    });
    await wait(1500);
    // ── notch drop: threat ──
    fs.mkdirSync('/tmp/dtenv/drop', { recursive: true }); fs.copyFileSync('/tmp/dtenv/scanset/indirilenler/eicar.com', '/tmp/dtenv/drop/eicar_test.com');
    await frames(N(), 'notch-drop-threat', 8600, async () => {
      await wait(300);
      await js(N(), `NotchDemo.drop(['/tmp/dtenv/drop/eicar_test.com'], 330, 70)`);
      await wait(3400); await shot(N(), '25-notch-drop-threat');
      await wait(1800);
      await js(N(), `document.querySelector('#sActs [data-a=quarantine]').click()`);
      await wait(800); await shot(N(), '26-notch-quarantined');
    });
    await wait(2500);
    save();
    }
    if (PH === 'B') {
    await wait(2500);
    // ── scanning in progress (large folder), notch progress pill ──
    await js(M(), `App.startScan('custom', ['/usr/share', '/usr/lib'])`);
    await wait(3500);
    await shot(M(), '06-scan-in-progress');
    await shot(N(), '27-notch-scan-progress');
    
    await js(M(), `dt.core('cancelScan')`); await wait(2500);

    // ── real scan of the test set → results with threats ──
    await js(M(), `App.go('scan')`); await wait(600);
    await shot(M(), '05-scan');
    await js(M(), `App.startScan('custom', ['/tmp/dtenv/scanset'])`);
    for (let i = 0; i < 60; i++) { await wait(500); if (!(await js(M(), 'App.state.scan ? 1 : 0'))) break; }
    await wait(1500);
    let route = await js(M(), 'App.route');
    if (!route.startsWith('results')) { const id = (await core.listScans())[0].id; await js(M(), `App.go('results/${id}')`); await wait(900); }
    await shot(M(), '08-results-threats');
    await js(M(), `document.querySelector('#resTable .tr.row').click()`); await wait(500);
    await shot(M(), '09-results-threat-details');
    // quarantine two, delete none, ignore none
    await js(M(), `(async()=>{const rows=[...document.querySelectorAll('#resTable [data-act=quarantine]')]; if(rows[0]) rows[0].click();})()`); await wait(1200);
    await js(M(), `(async()=>{const rows=[...document.querySelectorAll('#resTable [data-act=quarantine]')]; if(rows[0]) rows[0].click();})()`); await wait(1500);
    await shot(M(), '10-results-actions');
    // clean results
    const r = await core.scanPaths(['/tmp/dtenv/clean'], { source: 'drop' });
    await js(M(), `App.go('results/${r.id}')`); await wait(1400);
    await shot(M(), '07-results-clean');
    save();

    // ── quarantine, history, dashboard ──
    await js(M(), `App.go('quarantine')`); await wait(1000); await shot(M(), '11-quarantine');
    await js(M(), `App.go('history')`); await wait(1000); await shot(M(), '12-history');
    await js(M(), `App.go('dashboard')`); await wait(1500); await shot(M(), '13-dashboard');

    // ── settings ──
    const cats = ['general', 'protection', 'scan', 'notch', 'notifications', 'sound', 'appearance', 'quarantine', 'updates', 'about'];
    for (let i = 0; i < cats.length; i++) {
      await js(M(), `App.go('settings/${cats[i]}')`); await wait(cats[i] === 'about' || cats[i] === 'notch' ? 1600 : 800);
      await shot(M(), `14-settings-${String(i + 1).padStart(2, '0')}-${cats[i]}`);
    }
    save();
    }
    if (PH === 'C') {
    await wait(2500);
    // ── real-time protection → notch threat alert + toast slide-in ──
    await js(M(), `App.go('dashboard')`);
    await wait(800);
    await frames(host.toast, 'toast-slide', 3600, async () => {
      await wait(200);
      fs.copyFileSync('/tmp/dtenv/scanset/indirilenler/fatura.pdf.vbs', '/tmp/dtenv/home/Downloads/fatura.pdf.vbs');
      await wait(2700);
      await shot(N(), '28-notch-threat-alert');
    });
    await frames(N(), 'notch-alert', 1500);
    await wait(1200);
    await host.toastShow({ kind: 'info', mood: 'cool', title: host.t('t.dbUpdated'), body: host.t('t.dbUpdatedBody', { total: '1.900.548', added: '12.408' }), sound: 'blip' });
    await wait(500);
    await host.toastShow({ kind: 'success', mood: 'clean', title: host.t('t.scanDone'), body: host.t('t.scanDoneClean', { n: '4' }), actions: [{ id: 'open-results', label: host.t('t.view'), primary: true }], data: { scanId: (await core.listScans())[0].id } });
    await wait(1400);
    await shot(host.toast, '31-notifications-stack');
    await wait(1000);
    save();

    // ── mascot moods ──
    const mw = new BrowserWindow({ width: 1000, height: 520, show: true, frame: false, backgroundColor: '#0B0D12', webPreferences: { preload: path.join(__dirname, '../src/preload/preload.js') } });
    await mw.loadFile(path.join(__dirname, 'moods.html'));
    await wait(1200);
    await shot(mw, '40-mascot-moods');
    await framesSub(mw, 'mascot-moods', 5200);
    mw.destroy();
    save();
    }
  } catch (e) { log('ERROR', e && e.stack || e); }
  save();
  log('done');
  setTimeout(() => app.exit(0), 300);
};
