// Screenshot / GIF frame capture for the Android UI (not shipped).
// Renders the real mobile web UI at 412×915 CSS px (DPR 2) with a mocked native bridge, then compose.py adds the phone frame.
// Run: xvfb-run electron --no-sandbox capture.js <outDir> [only,comma,separated]
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
app.commandLine.appendSwitch('force-device-scale-factor', process.env.DT_DSF || '2');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-gpu');
const WEB = path.resolve(__dirname, '../../web');
const ARGS = process.argv.slice(process.argv.findIndex(a => a.endsWith('capture.js')) + 1);
const OUT = ARGS[0] || '/tmp/dtcap';
const ONLY = (ARGS[1] || '').split(',').filter(Boolean);
const SHOTS = path.join(OUT, 'shots'), FR = path.join(OUT, 'frames');
fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(FR, { recursive: true });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[cap]', ...a);
const b64 = (o) => Buffer.from(unescape(encodeURIComponent(JSON.stringify(o)))).toString('base64');

let win;
async function open(page, scene = {}, query = '') {
  if (!win) win = new BrowserWindow({ width: 412, height: 915, useContentSize: true, show: true, frame: false, backgroundColor: '#0B0D12',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: false, nodeIntegration: false, sandbox: false, backgroundThrottling: false } });
  if (!win._hooked) { win._hooked = true; win.webContents.on('console-message', (e, lvl, msg, line, src) => { if (lvl >= 2) console.log('[page]', msg, (src || '').split('/').pop() + ':' + line); }); }
  const file = page === 'home' ? path.join(__dirname, 'home.html') : path.join(WEB, page + '.html');
  const url = 'file://' + file + '?scene=' + encodeURIComponent(b64(scene)) + (query ? '&' + query : '') + '&n=' + Date.now();
  await win.loadURL('about:blank').catch(() => {});
  try { await win.loadURL(url); } catch (e) { await wait(300); await win.loadURL(url); }
  await js(STATUSBAR);
  await wait(scene.settle || 900);
}
const js = (code) => win.webContents.executeJavaScript(code, true);
async function shot(name) {
  await js(`document.fonts.ready.then(() => true)`).catch(() => {});
  let img;
  await js(`(() => { const d = document.documentElement; d.style.outline = '1px solid rgba(0,0,0,0.01)'; void d.offsetHeight; requestAnimationFrame(() => { d.style.outline = ''; }); return 1; })()`).catch(() => {});
  await wait(120);
  for (let i = 0; i < 6; i++) {   // retry until the compositor has a painted frame (status-bar clock is always white text)
    win.webContents.invalidate(); await wait(250); win.webContents.invalidate(); await wait(120);
    img = await win.webContents.capturePage();
    const sz = img.getSize(), bm = img.toBitmap(), rows = Math.min(sz.height, Math.round(sz.height * 30 / 915)); let bright = 0;
    for (let y = 0; y < rows; y++) for (let x = 0; x < sz.width; x++) { const o = (y * sz.width + x) * 4; if (bm[o] > 200 && bm[o + 1] > 200 && bm[o + 2] > 200) bright++; }
    if (bright > 60) break;
    log('blank frame, retry', name, bright); await wait(600);
  }
  fs.writeFileSync(path.join(SHOTS, name + '.png'), img.toPNG()); log('shot', name); }
async function frames(name, ms, during) {
  const dir = path.join(FR, name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const imgs = []; const t0 = Date.now(); let last = -1;
  win.webContents.beginFrameSubscription(false, (img) => { const ts = Date.now() - t0; if (ts - last < 55) return; last = ts; imgs.push({ ts, png: img.toPNG() }); });
  win.webContents.invalidate();
  const keep = setInterval(() => win.webContents.invalidate(), 50);
  const p = during ? during() : null;
  await wait(ms);
  clearInterval(keep);
  win.webContents.endFrameSubscription();
  if (p) await p.catch(() => {});
  const list = [];
  imgs.forEach((f, i) => { const fn = String(i).padStart(4, '0') + '.png'; fs.writeFileSync(path.join(dir, fn), f.png); list.push({ f: fn, ts: f.ts }); });
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(list));
  log('frames', name, list.length);
}
// Android status bar (time, signal, wifi, battery) + punch-hole camera, drawn over the page like the real system UI.
const STATUSBAR = `(() => { if (document.getElementById('__sb')) return; const d = document.createElement('div'); d.id = '__sb';
  d.innerHTML = '<span class="t">14:32</span><span class="r"><svg width="17" height="13" viewBox="0 0 17 13"><path d="M1 12h2V9H1zM5 12h2V7H5zM9 12h2V4H9zM13 12h2V1h-2z" fill="#fff"/></svg><svg width="17" height="13" viewBox="0 0 24 18"><path d="M12 17l3.5-4.3a5.6 5.6 0 00-7 0zM4.2 8.6l2.2 2.7a8.9 8.9 0 0111.2 0l2.2-2.7a12.3 12.3 0 00-15.6 0zM.5 4.1l2.2 2.7a14.6 14.6 0 0118.6 0l2.2-2.7a18 18 0 00-23 0z" fill="#fff"/></svg><span class="bt"><i style="width:82%"></i></span><span class="pc">82</span></span><i class="cam"></i>';
  const s = document.createElement('style'); s.textContent = '#__sb{position:fixed;left:0;right:0;top:0;height:32px;z-index:99999;pointer-events:none;display:flex;align-items:center;justify-content:space-between;padding:0 18px 0 22px;font:600 13.5px Inter,Roboto,sans-serif;color:#fff;letter-spacing:.01em}#__sb .r{display:flex;align-items:center;gap:6px}#__sb .bt{width:22px;height:11px;border:1.5px solid rgba(255,255,255,.85);border-radius:3.5px;padding:1px;position:relative}#__sb .bt i{display:block;height:100%;background:#fff;border-radius:1.5px}#__sb .bt::after{content:"";position:absolute;right:-4px;top:2.5px;width:2px;height:4px;background:rgba(255,255,255,.85);border-radius:0 1px 1px 0}#__sb .pc{font-size:12px}#__sb .cam{position:fixed;left:50%;top:9px;width:15px;height:15px;margin-left:-7.5px;border-radius:50%;background:radial-gradient(circle at 40% 38%,#24304a 0 2px,#07090d 3px);box-shadow:0 0 0 1.5px #000}';
  document.documentElement.appendChild(s); document.documentElement.appendChild(d);
  const f = document.createElement('div'); f.id = '__finger'; f.style.cssText = 'position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(255,255,255,.28);border:2px solid rgba(255,255,255,.55);z-index:99998;pointer-events:none;display:none;transition:transform .12s, opacity .2s;'; document.documentElement.appendChild(f);
  let downEl = null;
  window.__tap = (type, x, y) => {
    const o = { clientX: x, clientY: y, screenX: x, screenY: y, bubbles: true, cancelable: true, button: 0, buttons: type === 'mouseUp' ? 0 : 1, view: window };
    f.style.left = x + 'px'; f.style.top = y + 'px';
    if (type === 'mouseDown') { f.style.display = 'block'; f.style.transform = 'scale(.85)'; downEl = document.elementFromPoint(x, y); (downEl || document.body).dispatchEvent(new MouseEvent('mousedown', o)); }
    else if (type === 'mouseMove') { f.style.transform = 'scale(1)'; window.dispatchEvent(new MouseEvent('mousemove', o)); }
    else { window.dispatchEvent(new MouseEvent('mouseup', o)); f.style.display = 'none'; downEl = null; }
  };
})()`;

const want = (k) => !ONLY.length || ONLY.some(o => k.startsWith(o));
async function inNotch(code) { return js(`(() => { const N = document.getElementById('notchFrame').contentWindow.Notch; ${code} })()`); }
// synthetic touch-like pointer (a finger dot is drawn so GIFs show where the finger is)
async function mouse(type, x, y) { await js(`__tap(${JSON.stringify(type)}, ${x}, ${y})`); }
async function glide(x0, y0, x1, y1, ms, steps = 18) { for (let i = 1; i <= steps; i++) { const k = i / steps, e = 1 - Math.pow(1 - k, 2); await mouse('mouseMove', x0 + (x1 - x0) * e, y0 + (y1 - y0) * e); await wait(ms / steps); } }
async function tileCenter(name) { return js(`(() => { const t = [...document.querySelectorAll('.app-tile')].find(x => x.querySelector('.an').textContent === ${JSON.stringify(name)}); t.scrollIntoView({ block: 'center' }); const r = t.querySelector('.ai').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`); }
async function dragApp(name) {
  // the whole gesture runs inside the page so frame capture load can't slow the finger down
  const c = await tileCenter(name); await wait(250);
  await js(`(async () => { const w = (ms) => new Promise(r => setTimeout(r, ms)); const c = ${JSON.stringify(c)};
    const glide = async (x0, y0, x1, y1, ms, n) => { for (let i = 1; i <= n; i++) { const k = i / n, e = 1 - Math.pow(1 - k, 2); __tap('mouseMove', x0 + (x1 - x0) * e, y0 + (y1 - y0) * e); await w(ms / n); } };
    __tap('mouseDown', c.x, c.y); await w(480);
    await glide(c.x, c.y, c.x + 10, c.y - 120, 300, 8);
    await glide(c.x + 10, c.y - 120, 206, 120, 520, 16);
    await w(450); __tap('mouseUp', 206, 120); return 1; })()`);
}

(async () => {
  await app.whenReady();
  const S = async (name, page, scene, fn) => { if (!want(name)) return; try { await open(page, scene, scene.query || ''); await fn(); } catch (e) { console.log('[cap] FAIL', name, e && e.stack || e); } };
  const ONB = { settings: { onboarded: false } };

  // ── first run ──
  await S('01-acilis', 'main', Object.assign({ settle: 50 }, ONB), async () => { await frames('01-acilis', 4600); });
  // intro replayed on a warmed-up page (the very first frames after a cold load are not delivered reliably by the frame subscription)
  await S('01c-acilis-tekrar', 'main', Object.assign({ settle: 5600 }, ONB), async () => {
    await js(`(() => { document.querySelectorAll('#onboard .ob-screen').forEach(s => s.style.visibility = 'hidden'); return 1; })()`); await wait(300);
    await frames('01-acilis', 6200, () => js(`(() => { Onboarding.playIntro().then(() => { document.querySelectorAll('#onboard .ob-screen').forEach(s => s.style.visibility = ''); Onboarding.step = -1; Onboarding.goto(0); }); return 1; })()`)); });
  await S('01b-acilis-kare', 'main', Object.assign({ settle: 2600 }, ONB), async () => { await shot('01-acilis-animasyonu'); });
  await S('02-hosgeldiniz', 'main', Object.assign({ settle: 4900 }, ONB), async () => { await js(`document.getElementById('obEula').click()`); await wait(500); await shot('02-hosgeldiniz'); });
  const PK = ['storage', 'notifications', 'location', 'overlay', 'background', 'apps'];
  const PN = ['03-izin-1-tum-dosyalar', '04-izin-2-bildirimler', '05-izin-3-konum-hava', '06-izin-4-ustte-gosterim', '07-izin-5-arka-plan', '08-izin-6-uygulamalar'];
  for (let i = 0; i < 6; i++) await S(PN[i], 'main', Object.assign({ settle: 4700 }, ONB), async () => { await js(`Onboarding.goto(${i + 1}, true)`); await wait(1300); await shot(PN[i]); });
  await S('09-kurulum-tamam', 'main', Object.assign({ settle: 4700 }, ONB), async () => { await js(`Onboarding.choices = {storage:true,notifications:true,location:true,overlay:true,background:true,apps:true}; Onboarding.goto(7, true)`); await wait(1500); await shot('09-kurulum-tamam'); });

  // ── main screens ──
  await S('10-panel', 'main', {}, async () => { await wait(900); await shot('10-panel'); await js(`document.getElementById('v-dashboard').scrollTop = 620`); await wait(500); await shot('10b-panel-moduller'); });
  await S('11-tarama', 'main', { query: 'route=scan' }, async () => { await wait(600); await shot('11-tarama-secenekleri'); });
  await S('12-taraniyor', 'main', { query: 'route=scan' }, async () => {
    await js(`dt.core('startScan', { type: 'quick' }).then(() => App.go('scan', true))`); await wait(300);
    await js(`(() => { const m = __mock; const it = m.threatApp; m.emit('scan:threat', { scanId: 'Slive', item: it }); App._liveThreats = []; document.getElementById('liveThreats') && App.addLiveThreat(it);
      m.emit('scan:progress', { id: 'Slive', type: 'quick', status: 'running', scanned: 193, discovered: 418, discoveryDone: true, threats: 1, current: '/storage/emulated/0/Download/Faturalar/kasim_ozeti.pdf', elapsed: 71000, rate: 27, percent: 0.46 }); })()`);
    await wait(900); await shot('12-tarama-suruyor');
  });
  await S('13-sonuc-temiz', 'main', { query: 'route=results/Sclean' }, async () => { await wait(800); await shot('13-sonuc-temiz'); });
  await S('14-sonuc-tehdit', 'main', { query: 'route=results/Sthreat' }, async () => { await wait(800); await shot('14-sonuc-tehditler');
    await js(`document.querySelectorAll('#resTable .tr.row')[0].click()`); await wait(400); await js(`document.getElementById('v-results').scrollTop = 330`); await wait(300); await shot('15-tehdit-ayrintisi-uygulama');
    await js(`document.querySelectorAll('#resTable .tr.row')[0].click(); document.querySelectorAll('#resTable .tr.row')[3].click()`); await wait(300); await js(`document.querySelectorAll('#resTable .tr.row')[3].scrollIntoView({block:'center'})`); await wait(300); await shot('16-tehdit-ayrintisi-dosya'); });
  await S('17-sonuc-islemler', 'main', { actionsDone: true, query: 'route=results/Sthreat' }, async () => { await wait(800); await js(`document.getElementById('v-results').scrollTop = 250`); await wait(300); await shot('17-sonuc-islemler'); });
  await S('18-uygulamalar', 'main', { query: 'route=apps' }, async () => { await wait(1200); await shot('18-uygulamalar'); });
  await S('19-uygulama-ayrinti', 'main', { query: 'route=apps', appVerdicts: { 'com.android.system.update.service': 'malicious' } }, async () => { await wait(1100);
    await js(`(() => { const t = [...document.querySelectorAll('.app-tile')].find(x => x.querySelector('.an').textContent === 'Sistem Güncelleme'); Apps.sheet(Apps.filtered[+t.dataset.i]); })()`); await wait(1200); await shot('19-uygulama-ayrintisi'); });
  await S('20-karantina', 'main', { query: 'route=quarantine' }, async () => { await wait(700); await shot('20-karantina'); });
  await S('21-gecmis', 'main', { query: 'route=history' }, async () => { await wait(700); await shot('21-gecmis'); });
  await S('22-ayarlar', 'main', { query: 'route=settings' }, async () => { await wait(600); await shot('22-ayarlar'); });
  const CATS = ['general', 'protection', 'scan', 'notch', 'notifications', 'sound', 'appearance', 'quarantine', 'updates', 'about'];
  const CN = ['genel', 'koruma', 'tarama', 'centik', 'bildirimler', 'ses', 'gorunum', 'karantina', 'guncellemeler', 'hakkinda-lisans'];
  for (let i = 0; i < CATS.length; i++) await S('23-ayar-' + CN[i], 'main', { query: 'route=settings/' + CATS[i], perms: CATS[i] === 'general' ? { location: false } : {} }, async () => { await wait(900); await shot(`${23 + i}-ayarlar-${String(i + 1).padStart(2, '0')}-${CN[i]}`); });

  // ── notch (system overlay over the home screen) ──
  await S('33-centik-bosta', 'home', {}, async () => { await wait(1500); await shot('33-centik-bosta-saat-hava'); });
  await S('34-centik-genis', 'home', {}, async () => { await wait(1300); await js(`document.getElementById('ov').contentWindow.Notch.expandFromTile()`); await wait(1200); await shot('34-centik-genisletilmis'); });
  await S('35-centik-ilerleme', 'home', {}, async () => { await wait(1300); await js(`__mock.emit('scan:progress', { id: 'Slive', type: 'quick', status: 'running', scanned: 120, discovered: 418, discoveryDone: true, threats: 0, percent: 0.62 })`); await wait(1200); await shot('35-centik-arka-plan-tarama'); });
  await S('36-centik-uyari', 'home', {}, async () => { await wait(1300); await js(`__mock.emit('notch:alert', { source: 'realtime', action: 'quarantined', scanId: 'Sthreat', item: { name: 'fatura.pdf.vbs', threat: 'Trojan-Dropper.VBS.Agent', verdict: 'malicious', score: 87 } })`); await wait(700); await shot('36-centik-tehdit-uyarisi'); });
  await S('37-paylas', 'home', { share: true }, async () => { await wait(1300); await frames('paylas-centik', 7200, async () => { await js(`showShare()`); await wait(1500); await js(`pickShare()`); }); });

  // ── notch in-app drag (apps grid) ──
  await S('38-surukle-temiz', 'main', { query: 'route=apps' }, async () => { await wait(1300); await frames('uygulama-surukle-temiz', 9800, () => dragApp('Bankam')); });
  await S('39-surukle-tehdit', 'main', { query: 'route=apps' }, async () => { await wait(1300); await frames('uygulama-surukle-tehdit', 8600, () => dragApp('Sistem Güncelleme')); });
  await S('40-surukle-kareler', 'main', { query: 'route=apps' }, async () => { await wait(1300);
    const c = await tileCenter('Bankam'); await mouse('mouseDown', c.x, c.y); await wait(480); await glide(c.x, c.y, 318, 150, 600, 14); await wait(700); await shot('37-centik-uygulama-surukleme'); await mouse('mouseUp', 318, 150); await wait(1900); await shot('38-centik-uygulama-taraniyor'); await wait(150); await shot('39-centik-sonuc-temiz'); });
  await S('41-surukle-tehdit-kare', 'main', { query: 'route=apps' }, async () => { await wait(1300); await dragApp('Sistem Güncelleme'); await wait(3300); await shot('40-centik-sonuc-tehdit-uygulama'); });
  await S('42-dosya-surukle', 'main', { query: 'route=results/Sthreat' }, async () => { await wait(900);
    const r = await js(`(() => { const e = document.querySelectorAll('#resTable .tr.row')[1].querySelector('.ficon').getBoundingClientRect(); return { x: e.left + e.width / 2, y: e.top + e.height / 2 }; })()`);
    await frames('dosya-surukle-tehdit', 7600, async () => { await mouse('mouseDown', r.x, r.y); await wait(480); await glide(r.x, r.y, 206, 130, 700, 18); await wait(500); await mouse('mouseUp', 206, 130); });
  });

  // cross-app (global) drag from a Files app into the overlay notch
  await S('42b-dosya-surukle-global', 'home', { files: true }, async () => { await wait(1300); await frames('dosya-surukle-global', 9000, () => js(`__globalDrag(0)`)); });
  await S('42c-dosya-surukle-global-kare', 'home', { files: true }, async () => { await wait(1300); js(`__globalDrag(0)`); await wait(1350); await shot('41-centik-dosya-surukleme-baska-uygulamadan'); await wait(2600); await shot('42-centik-dosya-sonuc-tehdit'); });
  await S('46b-mochi-anim', 'home', { moods: true }, async () => { await wait(1200); await frames('mochi-ruh-halleri', 6000); });
  // ── notifications ──
  await S('43-bildirim', 'main', {}, async () => { await wait(700); await frames('bildirim-kayma', 2600, async () => { await wait(300); await js(`dt.ui('toast:show', { kind: 'danger', mood: 'alarmed', title: 'Tehdit engellendi', body: 'fatura.pdf.vbs karantinaya alındı (Trojan-Dropper.VBS.Agent).', actions: [{ id: 'open-results', label: 'Görüntüle', primary: true }], sound: 'blip', duration: 12000 })`); }); await shot('41-bildirim-ornek'); });
  await S('44-bildirim-yigin', 'main', {}, async () => { await wait(700);
    await js(`dt.ui('toast:show', { kind: 'info', mood: 'cool', title: 'Veritabanı güncellendi', body: '1.900.548 imza · +4.211 yeni imza', duration: 60000 })`); await wait(500);
    await js(`dt.ui('toast:show', { kind: 'success', mood: 'clean', title: 'Tarama tamamlandı', body: '412 öğe tarandı, tehdit bulunamadı.', actions: [{ id: 'open-results', label: 'Görüntüle', primary: true }], duration: 60000 })`); await wait(500);
    await js(`dt.ui('toast:show', { kind: 'danger', mood: 'alarmed', title: 'Zararlı uygulama yüklendi', body: 'Sistem Güncelleme — Trojan-Banker.AndroidOS.Generic. Kaldırmanız önerilir.', actions: [{ id: 'uninstall', label: 'Kaldır', primary: true }, { id: 'open-results', label: 'Görüntüle' }], duration: 60000 })`);
    await wait(2200); await shot('42-bildirimler-yigin'); });
  await S('45-sistem-bildirimi', 'home', { shade: true }, async () => { await wait(1500); await shot('43-sistem-bildirimi'); });
  await S('46-mochi', 'home', { moods: true }, async () => { await wait(1600); await shot('44-mochi-ruh-halleri'); });
  log('done'); app.quit();
})();
