/* Android bridge: provides the same window.dt API the desktop preload exposed (core / ui / on). */
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  const host = q.get('host') || 'main';           // main | inapp (notch iframe in the app) | overlay (system overlay notch)
  // The in-app notch iframe shares its parent's bridge (same origin).
  if (window.parent !== window) {
    try {
      const P = window.parent;
      if (P.dt) {
        window.dt = Object.assign({}, P.dt, {
          role: 'notch', host: q.get('host') || 'inapp',
          ui: (a, p) => (P.InAppNotch && P.InAppNotch.ui(a, p, window)) || P.dt.ui(a, p),
        });
        window.__dtInsetsVal = P.__dtInsetsVal;
        return;
      }
    } catch (e) { }
  }
  const N = window.DTNative;
  const pending = new Map();
  const listeners = new Map();
  let seq = 0;
  window.__dtRes = (id, ok, data) => { const p = pending.get(id); if (!p) return; pending.delete(id); ok ? p.res(data) : p.rej(new Error(data)); };
  window.__dtEvt = (name, data) => {
    const set = listeners.get(name);
    if (set) for (const cb of [...set]) { try { cb(data); } catch (e) { console.error(e); } }
    const any = listeners.get('*');
    if (any) for (const cb of [...any]) { try { cb(name, data); } catch (e) { } }
  };
  window.__dtInsetsVal = {};
  window.__dtInsets = (ins) => {
    window.__dtInsetsVal = ins || {};
    const r = document.documentElement.style;
    r.setProperty('--sat', (ins.top || 0) + 'px'); r.setProperty('--sab', (ins.bottom || 0) + 'px');
    if (ins.cutout) { r.setProperty('--cut-x', ins.cutout.x + 'px'); r.setProperty('--cut-h', ins.cutout.h + 'px'); }
    window.__dtEvt('insets', ins);
  };
  function call(kind, method, args) {
    if (!N) return Promise.reject(new Error('NO_BRIDGE'));
    return new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); N.post(id, kind, method, JSON.stringify(args || [])); });
  }
  window.dt = {
    role: host === 'overlay' ? 'notch' : 'main', host, platform: 'android',
    core: (method, ...args) => call('core', method, args),
    ui: (action, payload) => call('ui', action, [payload == null ? null : payload]),
    uiSync: (action, payload) => { call('ui', action, [payload]); return true; },
    on: (name, cb) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(cb); return () => listeners.get(name).delete(cb); },
    emit: (name, data) => window.__dtEvt(name, data),
    pathForFile: () => '',
    startDrag: () => {},
    haptic: (kind) => call('ui', 'haptic', [{ kind }]).catch(() => {}),
  };
  document.documentElement.classList.add('android', 'host-' + host);
})();
