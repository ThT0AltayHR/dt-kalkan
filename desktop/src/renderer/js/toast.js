(function () {
  const { t, $, esc, Sound } = UI;
  const TONES = { success: '52,211,153', danger: '244,80,94', warn: '251,191,36', info: 'var(--accent-rgb)' };
  const stack = $('#stack');
  const live = new Map();
  let product = 'DT Kalkan';
  dt.ui('app:info').then(i => { product = i.product.name; I18N.setApp(product); });
  dt.core('getState').then(st => { I18N.setLang(st.settings.lang); UI.applyAppearance(st.settings); Sound.set(st.settings.sound); });
  dt.on('state', st => { I18N.setLang(st.settings.lang); UI.applyAppearance(st.settings); Sound.set(st.settings.sound); });
  const icons = {};
  const iconFor = (mood) => icons[mood] || (icons[mood] = Mochi.still(mood, 54, { noShadow: true }));
  let over = false;
  stack.addEventListener('mouseenter', () => { over = true; dt.ui('toast:mouse', { over: true }); live.forEach(x => x.pause()); });
  stack.addEventListener('mouseleave', () => { over = false; dt.ui('toast:mouse', { over: false }); live.forEach(x => x.resume()); });
  document.addEventListener('mousemove', (e) => {
    const r = stack.getBoundingClientRect();
    const inside = live.size && e.clientX >= r.left && e.clientY <= r.bottom - 30;
    if (inside !== over) { over = inside; dt.ui('toast:mouse', { over: inside }); inside ? live.forEach(x => x.pause()) : live.forEach(x => x.resume()); }
  });
  function show(d) {
    const tone = TONES[d.kind] || TONES.info;
    const el = document.createElement('div');
    el.className = 'toast';
    el.style.setProperty('--tone', tone.startsWith('var') ? getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb') : tone);
    el.innerHTML = `<button class="x">${Icons.icon('x', 12)}</button>
      <div class="ti"><img src="${iconFor(d.mood || 'happy')}" alt=""></div>
      <div class="tb"><div class="th"><span class="app">${esc(product)}</span><span class="when">${t('common.now')}</span></div>
        <div class="tt">${esc(d.title)}</div>${d.body ? `<div class="bd">${esc(d.body)}</div>` : ''}
        ${d.actions && d.actions.length ? `<div class="ac">${d.actions.map(a => `<button data-a="${esc(a.id)}" class="${a.primary ? 'primary' : ''}">${esc(a.label)}</button>`).join('')}</div>` : ''}</div>
      <div class="pb"></div>`;
    stack.prepend(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
    if (d.sound) Sound.play(d.sound);
    const dur = d.duration || 6000;
    const pb = el.querySelector('.pb');
    const anim = pb.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: dur, fill: 'forwards' });
    anim.onfinish = () => close();
    const rec = { pause: () => anim.pause(), resume: () => anim.play() };
    live.set(d.id, rec);
    function close() {
      if (!live.has(d.id)) return;
      live.delete(d.id);
      el.classList.add('out');
      setTimeout(() => { el.classList.add('collapse'); }, 250);
      setTimeout(() => { el.remove(); if (!live.size) { over = false; dt.ui('toast:mouse', { over: false }); dt.ui('toast:empty'); } }, 700);
    }
    el.querySelector('.x').onclick = close;
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { if (b.dataset.a !== 'dismiss') dt.ui('toast:action', { action: b.dataset.a, data: d.data }); close(); });
    el.querySelector('.tt').onclick = () => { if (d.data && d.data.scanId) dt.ui('toast:action', { action: 'open-results', data: d.data }); };
    // keep at most 4
    const all = [...live.keys()];
    if (all.length > 4) { const old = stack.lastElementChild; if (old) { old.classList.add('out'); setTimeout(() => old.remove(), 400); live.delete(all[0]); } }
    return close;
  }
  dt.on('toast', show);
  window.ToastDemo = { show };
})();
