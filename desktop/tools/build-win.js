// Builds the Windows x64 app folder, patches exe resources (icon, version, admin manifest), then NSIS installer + portable.
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const PRODUCT = require('../src/config/product');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'out'), DIST = path.join(ROOT, '..', 'dist');
(async () => {
  const step = process.argv[2] || 'all';
  const appDir = path.join(OUT, `${PRODUCT.name}-win32-x64`);
  if (step === 'all' || step === 'pack') {
    execFileSync('node', [path.join(__dirname, 'build-rules.js')], { stdio: 'inherit' });
    const { packager } = require('@electron/packager');
    fs.rmSync(appDir, { recursive: true, force: true });
    await packager({
      dir: ROOT, out: OUT, platform: 'win32', arch: 'x64', overwrite: true, name: PRODUCT.name, executableName: PRODUCT.executableName,
      asar: { unpack: '{**/src/engine/**,**/data/**}' }, prune: true,
      ignore: [/^\/node_modules($|\/)/, /^\/installer($|\/)/, /^\/out($|\/)/, /^\/tools($|\/)/, /^\/rules-src($|\/)/, /^\/build\/icon-(16|24|48|64|128|1024)\.png$/, /^\/data\/rules\.json\.bak/, /\.map$/],
    });
    // strip Electron's own license files from the visible root; keep them inside a legal folder for compliance
    const legal = path.join(appDir, 'resources', 'legal'); fs.mkdirSync(legal, { recursive: true });
    for (const f of ['LICENSE', 'LICENSES.chromium.html']) { const p = path.join(appDir, f); if (fs.existsSync(p)) fs.renameSync(p, path.join(legal, f)); }
    for (const f of fs.readdirSync(path.join(ROOT, 'src/renderer/fonts')).filter(f => f.endsWith('.txt'))) fs.copyFileSync(path.join(ROOT, 'src/renderer/fonts', f), path.join(legal, f));
    fs.rmSync(path.join(appDir, 'version'), { force: true });
    console.log('packed', appDir);
  }
  if (step === 'all' || step === 'patch') {
    const ResEdit = require('resedit');
    const exePath = path.join(appDir, PRODUCT.executableName + '.exe');
    const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
    const res = ResEdit.NtExecutableResource.from(exe);
    // icon
    const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(ROOT, 'build/icon.ico')));
    const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
    const gid = groups.length ? groups[0].id : 1, glang = groups.length ? groups[0].lang : 1033;
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, gid, glang, ico.icons.map(i => i.data));
    // version info
    const vis = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
    const vi = vis[0];
    const [a, b, c] = PRODUCT.version.split('.').map(Number);
    vi.setFileVersion(a, b, c, 0, 1033); vi.setProductVersion(a, b, c, 0, 1033);
    for (const lang of vi.getAllLanguagesForStringValues()) {
      vi.setStringValues(lang, { CompanyName: PRODUCT.company, FileDescription: PRODUCT.name, ProductName: PRODUCT.name, LegalCopyright: PRODUCT.copyrightEn,
        OriginalFilename: PRODUCT.executableName + '.exe', InternalName: PRODUCT.executableName, FileVersion: PRODUCT.version, ProductVersion: PRODUCT.version });
      try { vi.removeStringValue(lang, 'SquirrelAwareVersion'); } catch { }
    }
    vi.outputToResourceEntries(res.entries);
    // manifest: require administrator
    const man = res.entries.find(e => e.type === 24);
    let xml = Buffer.from(man.bin).toString('utf8');
    if (/requestedExecutionLevel/.test(xml)) xml = xml.replace(/level=["'](asInvoker|highestAvailable)["']/, 'level="requireAdministrator"');
    else xml = xml.replace(/<\/assembly>\s*$/, `<trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges><requestedExecutionLevel level="requireAdministrator" uiAccess="false"/></requestedPrivileges></security></trustInfo></assembly>`);
    const mb = Buffer.from(xml, 'utf8'); man.bin = mb.buffer.slice(mb.byteOffset, mb.byteOffset + mb.length);
    res.outputResource(exe);
    fs.writeFileSync(exePath, Buffer.from(exe.generate()));
    console.log('patched', exePath, '\n', xml.match(/<requestedExecutionLevel[^>]*>/)[0]);
  }
})().catch(e => { console.error(e); process.exit(1); });
