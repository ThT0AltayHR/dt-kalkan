/* DT Kalkan icon set (24×24, stroke based) */
(function (g) {
  const P = {
    shield: '<path d="M12 3l7 3v5.5c0 4.6-3 8.4-7 9.5-4-1.1-7-4.9-7-9.5V6l7-3z"/>',
    shieldCheck: '<path d="M12 3l7 3v5.5c0 4.6-3 8.4-7 9.5-4-1.1-7-4.9-7-9.5V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
    shieldAlert: '<path d="M12 3l7 3v5.5c0 4.6-3 8.4-7 9.5-4-1.1-7-4.9-7-9.5V6l7-3z"/><path d="M12 8v4.5"/><path d="M12 16h.01"/>',
    home: '<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
    scan: '<path d="M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M20 16v2a2 2 0 01-2 2h-2M8 20H6a2 2 0 01-2-2v-2"/><path d="M4 12h16"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    zap: '<path d="M13 2L4.5 13.5H12L11 22l8.5-11.5H12L13 2z"/>',
    drive: '<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5.5 13L8 5h8l2.5 8"/><path d="M7 16.5h.01M10.5 16.5h.01"/>',
    folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>',
    file: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z"/><path d="M14 3v5h5"/>',
    fileCheck: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z"/><path d="M14 3v5h5"/><path d="M9.5 14.5l2 2 3.5-3.5"/>',
    fileWarn: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z"/><path d="M14 3v5h5"/><path d="M12 11v3.5M12 17.5h.01"/>',
    box: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    history: '<path d="M3.5 12a8.5 8.5 0 102.5-6"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    bell: '<path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15L6 16z"/><path d="M10 20a2 2 0 004 0"/>',
    volume: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/>',
    mute: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
    palette: '<path d="M12 3a9 9 0 100 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 005-5C21 6.4 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="14.5" cy="7" r="1"/><circle cx="17" cy="10.5" r="1"/>',
    notch: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8.5 4h7v2.2a1.8 1.8 0 01-1.8 1.8h-3.4a1.8 1.8 0 01-1.8-1.8V4z"/>',
    refresh: '<path d="M20 11a8 8 0 00-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0014.3 4.9L20 16"/><path d="M20 20v-4h-4"/>',
    download: '<path d="M12 4v11"/><path d="M7.5 11l4.5 4.5 4.5-4.5"/><path d="M5 20h14"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5S9.7 5.9 12 3.5z"/>',
    power: '<path d="M12 3v8"/><path d="M6.4 6.6a8 8 0 1011.2 0"/>',
    rocket: '<path d="M5 15c-1.5 1.5-2 4.5-2 6 1.5 0 4.5-.5 6-2"/><path d="M14.5 4.5C17 2 21 3 21 3s1 4-1.5 6.5L13 16l-5-5 6.5-6.5z"/><path d="M8 11l-3-1 2.5-3H11M13 16l1 3 3-2.5V13"/>',
    location: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    moon: '<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    alert: '<path d="M12 4l9 16H3L12 4z"/><path d="M12 10v4M12 17h.01"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
    restore: '<path d="M4 12a8 8 0 108-8 8.3 8.3 0 00-5.7 2.3L4 8.5"/><path d="M4 4v4.5h4.5"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 6.1A9.5 9.5 0 0112 6c5 0 8.5 4.5 9.5 6-.4.7-1.3 1.9-2.6 3.1M6.2 7.6C4.4 8.9 3.1 10.7 2.5 12c1 1.5 4.5 6 9.5 6 1.5 0 2.9-.4 4.1-1"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>',
    chevronRight: '<path d="M9 5l7 7-7 7"/>',
    chevronDown: '<path d="M5 9l7 7 7-7"/>',
    play: '<path d="M7 4.5v15l12.5-7.5L7 4.5z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    maximize: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    restoreWin: '<rect x="4" y="8" width="12" height="12" rx="2"/><path d="M8 8V6a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2h-2"/>',
    upload: '<path d="M12 16V5"/><path d="M7.5 9.5L12 5l4.5 4.5"/><path d="M5 19h14"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
    database: '<ellipse cx="12" cy="6" rx="7.5" ry="2.8"/><path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
    bug: '<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M12 12v8M9 5l1.5 2M15 5l-1.5 2M3 13h4M17 13h4M4 8l3 2M20 8l-3 2M4 19l3-2M20 19l-3-2"/>',
    sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
    grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 002 2h10a2 2 0 002-2V9"/><path d="M10 13h4"/>',
    code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
  };
  function icon(name, size = 18, extra = '') {
    const body = P[name] || P.info;
    return `<svg class="ic ${extra}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }
  // weather glyphs (filled, colored) — WMO weather codes
  function weatherIcon(code, isDay, size = 18) {
    const sun = '<circle cx="12" cy="12" r="4.2" fill="#FFC53D"/><g stroke="#FFC53D" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/></g>';
    const moon = '<path d="M17.5 14.6A6.6 6.6 0 019.4 6.5a6.6 6.6 0 108.1 8.1z" fill="#C9D4FF"/><circle cx="18" cy="6" r=".9" fill="#C9D4FF"/><circle cx="20.5" cy="10" r=".6" fill="#C9D4FF"/>';
    const cloud = (y = 0, c = '#E6EAF2') => `<path transform="translate(0 ${y})" d="M7.5 18.5h9.2a3.8 3.8 0 00.4-7.6 5.3 5.3 0 00-10.2 1.3A3.2 3.2 0 007.5 18.5z" fill="${c}"/>`;
    const small = (isDay ? '<g transform="translate(-3 -4) scale(.75)">' + sun + '</g>' : '<g transform="translate(-2 -4) scale(.75)">' + moon + '</g>');
    const rain = '<g stroke="#6CB8FF" stroke-width="1.7" stroke-linecap="round"><path d="M9 20.5l-.8 1.8M13 20.5l-.8 1.8M17 20.5l-.8 1.8"/></g>';
    const snow = '<g fill="#fff"><circle cx="9" cy="21.4" r="1"/><circle cx="13" cy="22" r="1"/><circle cx="17" cy="21.4" r="1"/></g>';
    const bolt = '<path d="M12.5 17l-2 3.5h2.2l-1 3 3.3-4.3h-2.2l1.2-2.2z" fill="#FFC53D"/>';
    let body;
    if (code === 0) body = isDay ? sun : moon;
    else if (code <= 2) body = small + cloud(1);
    else if (code === 3) body = cloud(-1, '#AEB6C6') + cloud(1);
    else if (code <= 48) body = cloud(-1) + '<g stroke="#AEB6C6" stroke-width="1.6" stroke-linecap="round"><path d="M5 20.5h14M7 22.5h10"/></g>';
    else if (code <= 67 || (code >= 80 && code <= 82)) body = cloud(-2) + rain;
    else if (code <= 77 || code === 85 || code === 86) body = cloud(-2) + snow;
    else body = cloud(-3, '#9AA3B5') + bolt;
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  }
  g.Icons = { icon, weatherIcon, names: Object.keys(P) };
})(window);
