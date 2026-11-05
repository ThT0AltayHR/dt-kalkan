/* Shared renderer helpers: settings cache, i18n binding, sounds, formatting, DOM. */
(function (g) {
  'use strict';
  const t = (k, v) => I18N.t(k, v);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ACCENTS = {
    mint: ['#5EF2C0', '#2BD4A0', '94,242,192'], ocean: ['#5AB8FF', '#2F8CF0', '90,184,255'], violet: ['#A98BFF', '#7C5CF5', '169,139,255'],
    coral: ['#FF8A7A', '#F2594B', '255,138,122'], amber: ['#FFC857', '#F2A93B', '255,200,87'],
  };
  function applyAppearance(s) {
    const a = ACCENTS[(s.appearance && s.appearance.accent) || 'mint'] || ACCENTS.mint;
    const r = document.documentElement.style;
    r.setProperty('--accent', a[0]); r.setProperty('--accent-2', a[1]); r.setProperty('--accent-rgb', a[2]);
    document.documentElement.classList.toggle('no-anim', s.appearance && s.appearance.animations === false);
  }

  // ── Sound engine ──
  const CAT = { pop: 'ui', hover: 'ui', wink: 'ui', love: 'ui', greet: 'ui', greeting: 'ui', proud: 'ui', yawn: 'ui', sleep: 'ui',
    open: 'notch', close: 'notch', peek: 'notch', attach: 'notch', gulp: 'notch', send: 'notch',
    search: 'scan', think: 'scan', work: 'scan', tick: 'scan', finish: 'scan', clean: 'scan',
    alarm: 'threat', error: 'threat', approval: 'threat', blip: 'ui', annoyed: 'threat' };
  const ALIAS = { clean: 'finish' };
  const Sound = {
    ctx: null, cache: new Map(), settings: { enabled: true, volume: 0.6, pack: 'soft', events: {} },
    set(s) { if (s) this.settings = s; },
    _ctx() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); if (this.ctx.state === 'suspended') this.ctx.resume(); return this.ctx; },
    async _buf(name) {
      const pack = this.settings.pack === 'minimal' ? 'minimal/' : '';
      const file = ALIAS[name] || name;
      const key = pack + file;
      if (this.cache.has(key)) return this.cache.get(key);
      const p = (async () => {
        for (const url of [`sounds/${pack}${file}.wav`, `sounds/${file}.wav`]) {
          try { const r = await fetch(url); if (!r.ok) continue; return await this._ctx().decodeAudioData(await r.arrayBuffer()); } catch { }
        }
        return null;
      })();
      this.cache.set(key, p);
      return p;
    },
    async play(name, opts = {}) {
      const s = this.settings;
      if (!s.enabled && !opts.force) return;
      const cat = CAT[name] || 'ui';
      if (!opts.force && s.events && s.events[cat] === false) return;
      try {
        const b = await this._buf(name); if (!b) return;
        const ctx = this._ctx();
        const src = ctx.createBufferSource(); src.buffer = b;
        if (opts.rate) src.playbackRate.value = opts.rate;
        const gain = ctx.createGain(); gain.gain.value = Math.max(0, Math.min(1, (s.volume ?? 0.6))) * (opts.gain || 1) * 0.9;
        src.connect(gain).connect(ctx.destination); src.start();
        return src;
      } catch { }
    },
    preload(names) { names.forEach(n => this._buf(n)); },
  };

  // ── formatting ──
  function fmtBytes(n) {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)).toString().replace('.', I18N.getLang() === 'tr' ? ',' : '.') + ' ' + u[i];
  }
  function fmtNum(n) { return Number(n || 0).toLocaleString(I18N.getLang() === 'tr' ? 'tr-TR' : 'en-US'); }
  function fmtAgo(ts) {
    if (!ts) return t('dash.lastNever');
    const d = (Date.now() - ts) / 1000;
    if (d < 60) return t('time.justNow');
    if (d < 3600) return t('time.minAgo', { n: Math.floor(d / 60) });
    if (d < 86400) return t('time.hourAgo', { n: Math.floor(d / 3600) });
    return t('time.dayAgo', { n: Math.floor(d / 86400) });
  }
  function fmtDur(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return t('time.sec', { n: s });
    const m = Math.floor(s / 60), r = s % 60;
    if (m < 60) return `${m}:${String(r).padStart(2, '0')}`;
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }
  function fmtIn(ts) {
    if (!ts) return '—';
    const d = Math.max(0, ts - Date.now()) / 60000;
    const locale = I18N.getLang() === 'tr' ? 'tr-TR' : 'en-US';
    if (d < 60) return t('time.in', { t: t('time.min', { n: Math.max(1, Math.round(d)) }) });
    const dt = new Date(ts), today = new Date();
    const time = dt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    if (dt.toDateString() === today.toDateString()) return `${t('time.today')} ${time}`;
    return dt.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + time;
  }
  function fmtDate(ts, withTime = true) {
    const locale = I18N.getLang() === 'tr' ? 'tr-TR' : 'en-US';
    const d = new Date(ts);
    return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }) + (withTime ? ' ' + d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '');
  }
  function fmtTime(ts) { return new Date(ts).toLocaleTimeString(I18N.getLang() === 'tr' ? 'tr-TR' : 'en-US', { hour: '2-digit', minute: '2-digit' }); }
  function midEllipsis(s, n = 70) { s = String(s || ''); if (s.length <= n) return s; const k = Math.floor((n - 1) / 2); return s.slice(0, k) + '…' + s.slice(-k); }
  function errText(e) { const code = String(e || '').split(':')[0]; return t('err.' + code) !== 'err.' + code ? t('err.' + code) : t('err.generic'); }

  function h(html) { const tpl = document.createElement('template'); tpl.innerHTML = html.trim(); return tpl.content.firstElementChild; }

  g.UI = { t, $, $$, esc, h, ACCENTS, applyAppearance, Sound, fmtBytes, fmtNum, fmtAgo, fmtDur, fmtIn, fmtDate, fmtTime, midEllipsis, errText };
})(window);
