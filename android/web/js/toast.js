/* Glass toasts (Apple-style) sliding in from the top — phone version of the desktop toast window. */
(function () {
  const { t, $, esc, Sound } = UI;
  const TONES = { success: '52,211,153', danger: '244,80,94', warn: '251,191,36', info: 'var(--accent-rgb)' };
  const stack = $('#stack');
  const live = new Map();
  let product = 'DT Kalkan';
  dt.ui('app:info').then(i => { product = i.product.name; });
  const icons = {};
  const iconFor = (mood) => icons[mood] || (icons[mood] = Mochi.still(mood, 54, { noShadow: true }));
  function show(d) {
    const tone = TONES[d.kind] || TONES.info;
    const el = document.createElement('div');
    el.className = 'toast';
    el.style.setProperty('--tone', tone.startsWith('var') ? getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb') : tone);
    el.innerHTML = `<div class="ti"><img src="${iconFor(d.mood || 'happy')}" alt=""></div>
      <div class="tb"><div class="th"><span class="app">${esc(product)}</span><span class="when">${t('common.now')}</span></div>
        <div class="tt">${esc(d.title)}</div>${d.body ? `<div class="bd">${esc(d.body)}</div>` : ''}
        ${d.actions && d.actions.length ? `<div class="ac">${d.actions.map(a => `<button data-a="${esc(a.id)}" class="${a.primary ? 'primary' : ''}">${esc(a.label)}</button>`).join('')}</div>` : ''}</div>
      <div class="pb"></div>`;
    stack.prepend(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
    if (d.sound) Sound.play(d.sound);
    dt.haptic && dt.haptic(d.kind === 'danger' ? 'double' : 'tick');
    const dur = d.duration || 6000;
    const pb = el.querySelector('.pb');
    const anim = pb.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: dur, fill: 'forwards' });
    anim.onfinish = () => close();
    live.set(d.id, { pause: () => anim.pause(), resume: () => anim.play() });
    function close() {
      if (!live.has(d.id)) return;
      live.delete(d.id);
      el.classList.add('out');
      setTimeout(() => { el.classList.add('collapse'); }, 250);
      setTimeout(() => el.remove(), 700);
    }
    // touch: hold to pause, swipe up to dismiss
    let y0 = null;
    el.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; anim.pause(); }, { passive: true });
    el.addEventListener('touchmove', (e) => { if (y0 == null) return; const dy = Math.min(0, e.touches[0].clientY - y0); el.style.transform = `translateY(${dy}px)`; }, { passive: true });
    el.addEventListener('touchend', (e) => { const dy = (e.changedTouches[0].clientY - (y0 ?? 0)); y0 = null; el.style.transform = ''; if (dy < -40) close(); else anim.play(); });
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = (e) => { e.stopPropagation(); if (b.dataset.a !== 'dismiss') toastAction(b.dataset.a, d.data); close(); });
    el.querySelector('.tt').onclick = () => { if (d.data && d.data.scanId) { toastAction('open-results', d.data); close(); } };
    const all = [...live.keys()];
    if (all.length > 3) { const old = stack.lastElementChild; if (old) { old.classList.add('out'); setTimeout(() => old.remove(), 400); live.delete(all[0]); } }
    return close;
  }
  function toastAction(a, data) {
    if (a === 'open-results' && data && data.scanId) return App.go('results/' + data.scanId);
    if (a === 'open-quarantine') return App.go('quarantine');
    dt.ui('toast:action', { action: a, data });
  }
  dt.on('toast', show);
  window.ToastDemo = { show };
})();
