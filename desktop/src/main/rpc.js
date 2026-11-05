'use strict';
// Line-delimited JSON RPC over a local pipe, used between the elevated protection core and the
// non-elevated UI process (needed so Explorer drag & drop reaches the UI windows under UIPI).
const net = require('net');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const PRODUCT = require('../config/product');

function pipePath() {
  const slug = PRODUCT.appId.replace(/[^a-z0-9]/gi, '-');
  return process.platform === 'win32' ? `\\\\.\\pipe\\${slug}-ui` : path.join(os.tmpdir(), `${slug}-ui.sock`);
}

function lineReader(sock, onMsg) {
  let buf = '';
  sock.setEncoding('utf8');
  sock.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line) continue;
      try { onMsg(JSON.parse(line)); } catch { /* ignore malformed */ }
    }
  });
}
const send = (sock, m) => { try { sock.write(JSON.stringify(m) + '\n'); } catch { } };

/** UI side: listens on the pipe, the core connects in. Exposes a Core-like proxy. */
class CoreProxy extends EventEmitter {
  constructor(methods) {
    super();
    this.sock = null; this.seq = 0; this.pending = new Map();
    for (const m of methods) this[m] = (...args) => this._call(m, args);
  }
  listen() {
    return new Promise((resolve, reject) => {
      const p = pipePath();
      if (process.platform !== 'win32') { try { require('fs').unlinkSync(p); } catch { } }
      this.server = net.createServer((sock) => {
        if (this.sock) { try { this.sock.destroy(); } catch { } }
        this.sock = sock;
        lineReader(sock, (m) => this._onMsg(m));
        sock.on('close', () => { if (this.sock === sock) { this.sock = null; this.emit('disconnected'); } });
        sock.on('error', () => {});
      });
      this.server.on('error', reject);
      this.server.listen(p, () => resolve(p));
    });
  }
  waitConnected(ms) {
    if (this.connected) return Promise.resolve(true);
    return new Promise((res) => { const t = setTimeout(() => res(false), ms); this.once('connected', () => { clearTimeout(t); res(true); }); });
  }
  _onMsg(m) {
    if (m.t === 'hello') { this.connected = true; this.coreInfo = m.info; this.emit('connected', m.info); return; }
    if (m.t === 'ret') { const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); m.ok ? p.res(m.v) : p.rej(new Error(m.e)); } return; }
    if (m.t === 'evt') { this.emit(m.n, m.d); return; }
    if (m.t === 'cmd') { this.emit('command', m.n, m.d); }
  }
  _call(method, args) {
    return new Promise((res, rej) => {
      if (!this.sock) return rej(new Error('CORE_OFFLINE'));
      const id = ++this.seq;
      this.pending.set(id, { res, rej });
      send(this.sock, { t: 'call', id, m: method, a: args });
    });
  }
  command(name, data) { if (this.sock) send(this.sock, { t: 'cmd', n: name, d: data }); }
}

/** Core side: connects to the UI pipe and serves calls on the real Core. */
function serveCore(core, { onCommand, retryMs = 500, maxWaitMs = 20000 } = {}) {
  const { Core } = require('./core');
  const allowed = new Set(Core.RPC_METHODS);
  let sock = null;
  const forward = {};
  const conn = new EventEmitter();
  for (const ev of Core.EVENTS) { forward[ev] = (d) => { if (sock) send(sock, { t: 'evt', n: ev, d }); }; core.on(ev, forward[ev]); }
  const start = Date.now();
  const attempt = () => {
    const s = net.connect(pipePath());
    s.on('connect', () => {
      sock = s;
      send(s, { t: 'hello', info: { pid: process.pid, version: PRODUCT.version } });
      lineReader(s, async (m) => {
        if (m.t === 'call') {
          if (!allowed.has(m.m)) return send(s, { t: 'ret', id: m.id, ok: false, e: 'FORBIDDEN' });
          try { const v = await core[m.m](...(m.a || [])); send(s, { t: 'ret', id: m.id, ok: true, v }); }
          catch (e) { send(s, { t: 'ret', id: m.id, ok: false, e: String(e && e.message || e) }); }
        } else if (m.t === 'cmd') onCommand && onCommand(m.n, m.d);
      });
      conn.emit('connected');
    });
    s.on('error', () => { if (!sock && Date.now() - start < maxWaitMs) setTimeout(attempt, retryMs); else if (!sock) conn.emit('failed'); });
    s.on('close', () => { if (sock === s) { sock = null; conn.emit('disconnected'); } });
  };
  attempt();
  conn.command = (n, d) => { if (sock) send(sock, { t: 'cmd', n, d }); };
  conn.isConnected = () => !!sock;
  return conn;
}

module.exports = { CoreProxy, serveCore, pipePath };
