/* First-run experience: intro animation, welcome + EULA, permission screens */
(function () {
  'use strict';
  const { t, $, $$, esc, Sound } = UI;
  const I = (n, s) => Icons.icon(n, s);
  const PERMS = [
    { key: 'realtime', icon: 'shield', mood: 'cool' },
    { key: 'startup', icon: 'power', mood: 'happy' },
    { key: 'notifications', icon: 'bell', mood: 'question' },
    { key: 'location', icon: 'location', mood: 'thinking' },
    { key: 'background', icon: 'moon', mood: 'sleepy' },
  ];
  const Onboarding = window.Onboarding = {
    step: -1, eula: false, mochis: [],
    start({ intro } = {}) {
      this.choices = {};
      const ob = $('#onboard');
      ob.classList.add('show');
      $('#shell').style.visibility = 'hidden';
      this.renderAll();
      if (intro) this.playIntro().then(() => this.goto(0));
      else this.goto(0);
    },
    playIntro() {
      return new Promise((res) => {
        const el = $('#intro');
        const name = App.info.product.name, parts = name.split(' ');
        el.innerHTML = `<div class="intro-stage">
          <div class="burst"></div>
          <svg class="shield" viewBox="0 0 200 220"><defs>
            <linearGradient id="ig" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="#7C8CFF"/></linearGradient>
            <radialGradient id="ig2" cx="50%" cy="35%" r="70%"><stop offset="0" stop-color="rgba(var(--accent-rgb),.22)"/><stop offset="1" stop-color="rgba(var(--accent-rgb),0)"/></radialGradient></defs>
            <path class="fill" d="M100 12l78 30v58c0 50-33 92-78 106-45-14-78-56-78-106V42z"/>
            <path class="outline" d="M100 12l78 30v58c0 50-33 92-78 106-45-14-78-56-78-106V42z"/></svg>
          <canvas id="introMochi"></canvas>
          <div class="intro-word"><div class="w1">${parts.length > 1 ? `${esc(parts[0])} <b>${esc(parts.slice(1).join(' '))}</b>` : esc(name)}</div><div class="w2">${t('intro.tag')}</div><div class="w3">${esc(App.info.product.company)}</div></div>
        </div>`;
        el.classList.add('show');
        const cv = $('#introMochi');
        const m = new Mochi(cv, { size: 190, mood: 'sleepy', noShadow: true });
        this.introMochi = m;
        setTimeout(() => Sound.play('open', { force: true }), 200);
        setTimeout(() => { m.setMood('happy'); m.jump(); Sound.play('greet', { force: true }); }, 1500);
        setTimeout(() => { m.setMood('love'); }, 2300);
        setTimeout(() => { el.classList.add('out'); }, 3600);
        setTimeout(() => { el.classList.remove('show', 'out'); m.destroy(); el.innerHTML = ''; res(); }, 4300);
      });
    },
    renderAll() {
      const ob = $('#onboard');
      const L = I18N.getLang();
      ob.innerHTML = `
        <div class="ob-screen ob-welcome" data-s="0">
          <div class="ob-lang"><div class="seg" id="obLang"><button data-l="tr" class="${L === 'tr' ? 'active' : ''}">Türkçe</button><button data-l="en" class="${L === 'en' ? 'active' : ''}">English</button></div></div>
          <canvas id="obWelcome"></canvas>
          <div class="hello">${t('welcome.hello')}</div>
          <h1>${t('welcome.title')}</h1>
          <p>${t('welcome.sub')}</p>
          <label class="ob-eula" id="obEula"><span class="check ${this.eula ? 'on' : ''}">${I('check', 14)}</span><span>${t('welcome.eula')}</span></label>
          <div class="ob-actions"><button class="btn primary lg" id="obStart" ${this.eula ? '' : 'disabled'}>${t('welcome.start')}${I('chevronRight', 18)}</button></div>
        </div>
        ${PERMS.map((p, i) => `
        <div class="ob-screen" data-s="${i + 1}">
          <div class="perm">
            <div class="p-vis"><canvas data-pm="${i}"></canvas><div class="p-glyph">${I(p.icon, 28)}</div></div>
            <div>
              <div class="p-step">${t('perm.step', { i: i + 1, n: PERMS.length })}</div>
              <h2>${t('perm.' + p.key + '.title')}</h2>
              <p>${t('perm.' + p.key + '.desc')}</p>
              <ul>${[1, 2, 3].map(k => `<li>${I('check', 18)}<span>${t('perm.' + p.key + '.b' + k)}</span></li>`).join('')}</ul>
              <div class="p-actions"><button class="btn primary lg" data-allow="${p.key}">${t('perm.allow')}</button><button class="btn ghost lg" data-skip="${p.key}">${t('perm.skip')}</button></div>
              <div class="p-note" id="note-${p.key}"></div>
            </div>
          </div>
        </div>`).join('')}
        <div class="ob-screen ob-done" data-s="${PERMS.length + 1}">
          <canvas id="obDone"></canvas>
          <h1>${t('perm.done.title')}</h1>
          <p class="muted" style="font-size:15px;max-width:520px;margin:0 auto;line-height:1.6">${t('perm.done.sub')}</p>
          <div class="ob-sum" id="obSum"></div>
          <div class="ob-actions"><button class="btn primary lg" id="obGo">${t('perm.done.go')}${I('chevronRight', 18)}</button></div>
        </div>
        <div class="dots" id="obDots">${PERMS.map(() => '<i></i>').join('')}</div>`;
      this.mochis.forEach(m => m.destroy()); this.mochis = [];
      const mk = (cv, size, mood) => { const m = new Mochi(cv, { size, mood }); this.mochis.push(m); return m; };
      this.mW = mk($('#obWelcome'), 230, 'love');
      this.pm = $$('[data-pm]', ob).map((cv, i) => mk(cv, 260, PERMS[i].mood));
      this.mD = mk($('#obDone'), 240, 'proud');
      $('#obEula').onclick = (e) => {
        if (e.target.closest('[data-act="eula"]')) { e.preventDefault(); App.showEula(); return; }
        this.eula = !this.eula; $('#obEula .check').classList.toggle('on', this.eula); $('#obStart').disabled = !this.eula; Sound.play('pop', { gain: .6 });
      };
      $('#obStart').onclick = () => { Sound.play('wink'); this.goto(1); };
      $$('#obLang [data-l]').forEach(b => b.onclick = async () => {
        await dt.core('setSettings', { lang: b.dataset.l }); I18N.setLang(b.dataset.l);
        const cur = this.step; this.renderAll(); this.goto(cur, true); App.rerender(); $('#shell').style.visibility = 'hidden';
      });
      $$('[data-allow]', ob).forEach(b => b.onclick = () => this.decide(b.dataset.allow, true));
      $$('[data-skip]', ob).forEach(b => b.onclick = () => this.decide(b.dataset.skip, false));
      $('#obGo').onclick = () => this.finish();
    },
    goto(i, instant) {
      const prev = this.step;
      this.step = i;
      $$('#onboard .ob-screen').forEach(s => {
        const k = +s.dataset.s;
        s.classList.toggle('active', k === i);
        s.classList.toggle('leave', k === prev && k !== i && !instant);
        if (k !== i && k !== prev) s.classList.remove('leave');
      });
      setTimeout(() => $$('#onboard .ob-screen.leave').forEach(s => s.classList.remove('leave')), 600);
      const dots = $('#obDots');
      dots.style.display = i >= 1 && i <= PERMS.length ? 'flex' : 'none';
      $$('i', dots).forEach((d, k) => { d.className = k + 1 === i ? 'on' : k + 1 < i ? 'done' : ''; });
      if (i >= 1 && i <= PERMS.length) { const m = this.pm[i - 1]; m.jump(); }
      if (i === PERMS.length + 1) { this.mD.setMood('proud', false); Sound.play('proud'); this.renderSummary(); }
    },
    async decide(key, allow) {
      this.choices[key] = allow;
      const m = this.pm[PERMS.findIndex(p => p.key === key)];
      const note = $('#note-' + key);
      const patch = { permissions: { [key]: allow } };
      if (key === 'realtime') patch.protection = { realtime: allow };
      if (key === 'startup') patch.general = { startup: allow };
      if (key === 'notifications') patch.notifications = { enabled: allow };
      if (key === 'location') patch.notch = { weather: allow };
      if (key === 'background') { patch.general = Object.assign(patch.general || {}, { closeToTray: allow }); patch.scan = { schedule: { enabled: allow } }; }
      await dt.core('setSettings', patch);
      if (allow) { m.setMood('clean'); Sound.play('approve'); }
      else { m.setMood('sleepy'); Sound.play('pop', { gain: .6 }); }
      let wait = 900;
      if (allow && key === 'notifications') {
        note.textContent = t('perm.preview.toast');
        dt.ui('toast:show', { kind: 'info', mood: 'happy', title: t('t.test'), body: t('t.testBody'), sound: 'blip', force: true });
        wait = 1500;
      }
      if (allow && key === 'location') {
        note.innerHTML = '…';
        const w = await dt.core('getWeather', true).catch(() => null);
        note.innerHTML = w ? `${Icons.weatherIcon(w.code, w.isDay, 16).replace('<svg', '<svg style="vertical-align:-3px;margin-right:4px"')}${esc(t('perm.preview.weather', { city: w.city || '', temp: Math.round(w.temp) + '°' + (w.unit === 'f' ? 'F' : 'C') }))}` : '';
        wait = 1600;
      }
      setTimeout(() => this.goto(this.step + 1), wait);
    },
    renderSummary() {
      $('#obSum').innerHTML = PERMS.map(p => `<span class="chip ${this.choices[p.key] ? 'on' : ''}">${I(this.choices[p.key] ? 'check' : 'x', 13)}${t('perm.' + p.key + '.title')}</span>`).join('');
    },
    async finish() {
      await dt.ui('onboarding:done');
      Sound.play('send');
      const ob = $('#onboard');
      ob.style.transition = 'opacity .45s'; ob.style.opacity = '0';
      $('#shell').style.visibility = '';
      setTimeout(() => { ob.classList.remove('show'); ob.style.opacity = ''; this.mochis.forEach(m => m.destroy()); this.mochis = []; ob.innerHTML = ''; App.go('dashboard'); }, 450);
    },
  };
})();
