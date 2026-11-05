'use strict';
// Encrypted quarantine vault: AES-256-GCM, streamed. Layout: 'DTQ1' | iv(12) | ciphertext | tag(16)
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

class Quarantine {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    const kf = path.join(dir, '.vault.key');
    try { this.key = fs.readFileSync(kf); if (this.key.length !== 32) throw 0; }
    catch { this.key = crypto.randomBytes(32); fs.writeFileSync(kf, this.key); }
    this.indexFile = path.join(dir, 'index.json');
    try { this.items = JSON.parse(fs.readFileSync(this.indexFile, 'utf8')); } catch { this.items = []; }
    // drop index entries whose payload vanished
    this.items = this.items.filter(i => fs.existsSync(this._blob(i.id)));
  }
  _blob(id) { return path.join(this.dir, id + '.dtq'); }
  _save() { try { fs.writeFileSync(this.indexFile, JSON.stringify(this.items, null, 1)); } catch { } }
  list() { return this.items.slice().sort((a, b) => b.date - a.date); }
  get(id) { return this.items.find(i => i.id === id); }
  findBySha(sha) { return this.items.find(i => i.sha256 === sha); }

  async add(file, meta = {}) {
    const st = await fsp.stat(file);
    const id = Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const out = this._blob(id);
    const ws = fs.createWriteStream(out);
    ws.write(Buffer.concat([Buffer.from('DTQ1'), iv]));
    await pipeline(fs.createReadStream(file), cipher, ws);
    await fsp.appendFile(out, cipher.getAuthTag());
    // remove the original; if locked, retry once after a short delay
    try { await fsp.unlink(file); }
    catch (e) {
      await new Promise(r => setTimeout(r, 600));
      try { await fsp.unlink(file); }
      catch (e2) { await fsp.unlink(out).catch(() => {}); throw new Error('LOCKED:' + (e2.code || e2.message)); }
    }
    const item = {
      id, name: path.basename(file), originalPath: file, size: st.size, date: Date.now(),
      sha256: meta.sha256 || null, threat: meta.threat || null, verdict: meta.verdict || 'malicious', score: meta.score || 0, source: meta.source || 'scan',
    };
    this.items.push(item); this._save();
    return item;
  }

  async restore(id, target) {
    const item = this.get(id);
    if (!item) throw new Error('NOT_FOUND');
    let dest = target || item.originalPath;
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) {
      const ext = path.extname(dest), base = dest.slice(0, dest.length - ext.length);
      let n = 1; while (fs.existsSync(`${base} (${n})${ext}`)) n++;
      dest = `${base} (${n})${ext}`;
    }
    const blob = this._blob(id);
    const st = await fsp.stat(blob);
    const fd = await fsp.open(blob, 'r');
    const head = Buffer.alloc(16), tag = Buffer.alloc(16);
    await fd.read(head, 0, 16, 0);
    await fd.read(tag, 0, 16, st.size - 16);
    await fd.close();
    if (head.toString('latin1', 0, 4) !== 'DTQ1') throw new Error('CORRUPT');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, head.subarray(4, 16));
    decipher.setAuthTag(tag);
    const tmp = dest + '.dtrestore';
    try {
      await pipeline(fs.createReadStream(blob, { start: 16, end: st.size - 17 }), decipher, fs.createWriteStream(tmp));
      await fsp.rename(tmp, dest);
    } catch (e) { await fsp.unlink(tmp).catch(() => {}); throw e; }
    await fsp.unlink(blob).catch(() => {});
    this.items = this.items.filter(i => i.id !== id); this._save();
    return { item, restoredTo: dest };
  }

  async remove(id) {
    const item = this.get(id);
    await fsp.unlink(this._blob(id)).catch(() => {});
    this.items = this.items.filter(i => i.id !== id); this._save();
    return item;
  }

  async purgeOlderThan(days) {
    if (!days) return 0;
    const lim = Date.now() - days * 86400000;
    const old = this.items.filter(i => i.date < lim);
    for (const i of old) await this.remove(i.id);
    return old.length;
  }

  size() { return this.items.reduce((a, i) => a + (i.size || 0), 0); }
}
module.exports = { Quarantine };
