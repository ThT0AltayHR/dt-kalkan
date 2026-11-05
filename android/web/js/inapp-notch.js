/* In-app dynamic notch: hosts notch.html in a full-screen iframe around the camera cutout and implements
   long-press drag of app icons / files / result rows into it (the phone version of desktop drag-and-drop). */
(function () {
  'use strict';
  const { $ } = UI;
  const frame = $('#notchFrame'), hit = $('#notchHit'), ghost = $('#dragGhost');
  const ZONE = 230;               // finger within this distance from the top → lid opens
  const LONG = 360;               // long-press delay (ms)
  const N = () => { try { return frame.contentWindow.Notch; } catch { return null; } };
  let pill = [200, 36], state = 'idle', drag = null, lifted = null;

  const InAppNotch = window.InAppNotch = {
    get state() { return state; },
    ui(action, p) {
      if (action === 'notch:size') { if (p && p.pill) pill = p.pill; this.placeHit(); return Promise.resolve(true); }
      if (action === 'notch:mouse' || action === 'notch:focus') return Promise.resolve(true);
      if (action === 'notch:geom') return Promise.resolve(Object.assign({ width: innerWidth, height: innerHeight }, window.__dtInsetsVal || {}));
      if (action === 'main:show') { if (p && p.route) App.go(p.route); return Promise.resolve(true); }
      return null;
    },
    placeHit() {
      const ins = window.__dtInsetsVal || {};
      const cx = ins.cutout && ins.cutout.x ? ins.cutout.x : innerWidth / 2;
      const island = document.body.classList.contains('island-notch');
      hit.style.left = Math.round(cx - pill[0] / 2) + 'px'; hit.style.width = pill[0] + 'px';
      hit.style.top = (island ? 6 : 0) + 'px'; hit.style.height = pill[1] + 'px';
    },
    setInteractive(on) { frame.style.pointerEvents = on ? 'auto' : 'none'; hit.style.display = on ? 'none' : 'block'; },
    expand() { const n = N(); if (n) n.expandFromTile(); },
    back() { const n = N(); if (n && (state === 'hover' || state === 'alert')) { n.collapse(); return true; } return false; },
    xdrag(kind, x, y) { const n = N(); if (n) n.xdrag(kind, x, y); },
    xdrop(paths, x, y) { const n = N(); if (n) n.xdrop(paths, x, y); },
    incoming(paths) { const n = N(); if (n) n.incoming(paths, paths.map(p => decodeURIComponent(String(p).split('/').pop()))); },
    drop(paths, x, y, opts) { const n = N(); if (!n || n.busy) return; n.dragEnter(); setTimeout(() => n.handleDrop(paths, x, y, opts), 420); },

    /** Long-press + drag support for any element. getData() → { paths, name, icon, anchor } */
    draggable(el, getData) {
      let timer = null, sx = 0, sy = 0, pid = null;
      const cancel = () => { clearTimeout(timer); timer = null; };
      const start = (x, y) => {
        const n = N(); if (!n || n.busy) return;
        const d = getData(); if (!d) return;
        el._dragged = true; setTimeout(() => { el._dragged = false; }, 400);
        const a = (d.anchor || el).getBoundingClientRect();
        drag = { el, d, home: { x: a.left + a.width / 2, y: a.top + a.height / 2 }, over: false, x, y };
        ghost.innerHTML = d.icon ? `<img src="${d.icon}" alt="">` : `<div class="gp"><div class="gx">${(d.name || '').includes('.') ? d.name.split('.').pop().slice(0, 4) : 'FILE'}</div></div>`;
        ghost.className = 'on' + (d.icon ? ' app' : '');
        this.moveGhost(x, y);
        el.classList.add('lifted'); lifted = el;
        dt.haptic('heavy'); UI.Sound.play('pop', { gain: 0.5 });
      };
      const move = (x, y) => {
        if (!drag) return;
        drag.x = x; drag.y = y; this.moveGhost(x, y);
        const n = N(); if (!n) return;
        const over = y < ZONE;
        if (over && !drag.over) { drag.over = true; n.xdrag('enter', x, y); ghost.classList.add('near'); }
        else if (!over && drag.over) { drag.over = false; n.xdrag('leave', x, y); ghost.classList.remove('near'); }
        if (over) n.xdrag('move', x, y);
      };
      const end = () => {
        cancel();
        if (!drag) return;
        const d = drag; drag = null;
        const n = N();
        if (d.over && n) {
          ghost.className = '';
          n.handleDrop(d.d.paths, d.x, d.y, { icon: d.d.icon, name: d.d.name, back: d.home });
        } else {
          // snap back to where it came from
          ghost.animate([{ transform: ghost.style.transform }, { transform: `translate(${d.home.x - 26}px, ${d.home.y - 26}px) scale(1)` }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' }).finished.then(() => { ghost.className = ''; });
          this.unlift();
        }
      };
      el.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        const tch = e.touches[0]; sx = tch.clientX; sy = tch.clientY;
        cancel(); timer = setTimeout(() => { timer = null; start(sx, sy); }, LONG);
      }, { passive: true });
      el.addEventListener('touchmove', (e) => {
        const tch = e.touches[0];
        if (drag) { e.preventDefault(); move(tch.clientX, tch.clientY); return; }
        if (timer && Math.hypot(tch.clientX - sx, tch.clientY - sy) > 9) cancel();
      }, { passive: false });
      el.addEventListener('touchend', () => end());
      el.addEventListener('touchcancel', () => end());
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      // mouse (desktop testing / Chromebooks)
      el.addEventListener('mousedown', (e) => { if (e.button) return; sx = e.clientX; sy = e.clientY; pid = 1; cancel(); timer = setTimeout(() => { timer = null; start(sx, sy); }, LONG); });
      window.addEventListener('mousemove', (e) => { if (!pid) return; if (drag) move(e.clientX, e.clientY); else if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 9) cancel(); });
      window.addEventListener('mouseup', () => { if (!pid) return; pid = null; end(); });
    },
    moveGhost(x, y) { ghost.style.transform = `translate(${x - 26}px, ${y - 46}px) scale(1.08)`; },
    unlift() { if (lifted) { const l = lifted; lifted = null; l.classList.remove('lifted'); l.animate([{ transform: 'scale(.86)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'cubic-bezier(.34,1.56,.64,1)' }); } },
  };
  // notch state → whether the iframe takes touches (expanded panels have buttons; drag/scan must not steal the finger)
  dt.on('notch:state', (s) => { state = s; InAppNotch.setInteractive(s === 'hover' || s === 'result' || s === 'alert'); });
  dt.on('notch:landed', () => InAppNotch.unlift());
  dt.on('notch:finished', () => InAppNotch.unlift());
  dt.on('insets', () => InAppNotch.placeHit());
  const vis = (st) => { document.body.classList.toggle('island-notch', st.settings.notch.style === 'island'); const on = st.settings.notch.enabled && st.settings.onboarded; frame.style.visibility = on ? '' : 'hidden'; hit.style.visibility = on ? '' : 'hidden'; InAppNotch.placeHit(); };
  InAppNotch.applyState = vis;
  dt.on('state', vis);
  dt.core('getState').then(vis).catch(() => {});
  hit.addEventListener('click', () => { const n = N(); if (!n) return; const p = frame.contentDocument.getElementById('pill'); p && p.click(); });
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    // tap outside the expanded pill collapses it (desktop: mouse leave)
    doc.addEventListener('pointerdown', (e) => { const n = N(); if (!n) return; if (!e.target.closest('#pill') && (state === 'hover' || state === 'alert')) n.collapse(); });
  });
  InAppNotch.setInteractive(false);
  InAppNotch.placeHit();
})();
