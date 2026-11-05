'use strict';
const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');

const JOB_TIMEOUT = 90_000;

class ScanPool {
  constructor({ sigPath, rulesPath, settings, allow, size }) {
    this.opts = { sigPath, rulesPath, settings, allow: [...(allow || [])] };
    this.size = size || Math.max(1, Math.min(4, os.cpus().length - 1));
    this.workers = [];
    this.queue = [];
    this.seq = 0;
    for (let i = 0; i < this.size; i++) this._spawn();
  }
  _spawn() {
    const w = new Worker(path.join(__dirname, 'worker.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'), { workerData: this.opts });
    const slot = { w, busy: null, ready: false };
    w.on('message', (m) => {
      if (m.type === 'ready') { slot.ready = true; this.info = { sigs: m.sigs, rules: m.rules }; this._pump(); }
      else if (m.type === 'result' && slot.busy && slot.busy.id === m.id) {
        const job = slot.busy; slot.busy = null; clearTimeout(job.timer);
        job.resolve(m.result); this._pump();
      } else if (m.type === 'reloaded') { this.info = Object.assign({}, this.info, { sigs: m.sigs }); }
    });
    w.on('error', () => {});
    w.on('exit', () => {
      const idx = this.workers.indexOf(slot);
      if (idx >= 0) this.workers.splice(idx, 1);
      if (slot.busy) { clearTimeout(slot.busy.timer); slot.busy.resolve({ path: slot.busy.path, error: 'WORKER_CRASH' }); }
      if (!this.closed) this._spawn();
    });
    this.workers.push(slot);
  }
  _pump() {
    for (const slot of this.workers) {
      if (!this.queue.length) return;
      if (!slot.ready || slot.busy) continue;
      const job = this.queue.shift();
      slot.busy = job;
      job.timer = setTimeout(() => { slot.busy = null; job.resolve({ path: job.path, error: 'TIMEOUT' }); slot.w.terminate(); }, JOB_TIMEOUT);
      slot.w.postMessage({ type: 'scan', id: job.id, path: job.path });
    }
  }
  scan(p) {
    return new Promise((resolve) => { this.queue.push({ id: ++this.seq, path: p, resolve }); this._pump(); });
  }
  get pending() { return this.queue.length + this.workers.filter(s => s.busy).length; }
  updateSettings(settings, allow) {
    this.opts.settings = settings; if (allow) this.opts.allow = [...allow];
    for (const s of this.workers) s.w.postMessage({ type: 'settings', settings, allow: this.opts.allow });
  }
  reload(sigPath, rulesPath) {
    if (sigPath) this.opts.sigPath = sigPath; if (rulesPath) this.opts.rulesPath = rulesPath;
    for (const s of this.workers) s.w.postMessage({ type: 'reload', sigPath: this.opts.sigPath, rulesPath: this.opts.rulesPath });
  }
  close() { this.closed = true; for (const s of this.workers) s.w.terminate(); }
}
module.exports = { ScanPool };
