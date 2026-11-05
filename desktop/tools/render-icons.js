// electron tools/render-icons.js  → build/icon-*.png, tray*.png, drag.png
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const out = path.join(__dirname, '../build'); fs.mkdirSync(out, { recursive: true });
const svg = fs.readFileSync(path.join(__dirname, '../src/renderer/img/logo.svg'), 'utf8');
const dot = (c) => svg.replace('</svg>', `<circle cx="206" cy="206" r="44" fill="${c}" stroke="#0B0D12" stroke-width="12"/></svg>`);
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  const shot = async (s, size, file) => {
    const html = `<html><body style="margin:0;background:transparent"><img id=i style="width:${size}px;height:${size}px;display:block" src="data:image/svg+xml;base64,${Buffer.from(s).toString('base64')}"></body></html>`;
    await w.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
    await new Promise(r => setTimeout(r, 250));
    const img = await w.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    fs.writeFileSync(path.join(out, file), img.resize({ width: size, height: size }).toPNG());
  };
  for (const s of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) await shot(svg, s, `icon-${s}.png`);
  fs.copyFileSync(path.join(out, 'icon-512.png'), path.join(out, 'icon.png'));
  await shot(svg, 32, 'tray.png'); await shot(dot('#5AB8FF'), 32, 'tray-scan.png'); await shot(dot('#F4505E'), 32, 'tray-alert.png');
  await shot(svg, 64, 'drag.png');
  app.quit();
});
