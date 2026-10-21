/* Icon set (static, trusted SVG). Use LW.icon(name) to get markup. */
(function (root) {
  const LW = root.LW;
  const S = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const F = 'viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"';
  const I = {
    play: `<svg class="i-play" ${F}><path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.9-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z"/></svg>`,
    pause: `<svg class="i-pause" ${F}><rect x="6" y="5" width="4.2" height="14" rx="1.3"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.3"/></svg>`,
    rew: `<svg ${F}><rect x="5" y="6" width="2.4" height="12" rx="1"/><path d="M19 6.8v10.4a.8.8 0 0 1-1.25.66L10.4 12.66a.8.8 0 0 1 0-1.32l7.35-5.2A.8.8 0 0 1 19 6.8z"/></svg>`,
    fwd: `<svg ${F}><rect x="16.6" y="6" width="2.4" height="12" rx="1"/><path d="M5 6.8v10.4a.8.8 0 0 0 1.25.66l7.35-5.2a.8.8 0 0 0 0-1.32L6.25 6.14A.8.8 0 0 0 5 6.8z"/></svg>`,
    stop: `<svg ${F}><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>`,
    loop: `<svg ${S}><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>`,
    metro: `<svg ${S}><path d="M9 3h6l4 18H5L9 3z"/><path d="M12 15l5-8"/></svg>`,
    phone: `<svg ${S}><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg>`,
    gear: `<svg ${S}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
    wave: `<svg ${S}><path class="wv" d="M2 12c2-5 4-5 6 0s4 5 6 0 4-5 6 0"/></svg>`,
    grid: `<svg ${S}><rect x="3" y="3" width="7.5" height="7.5" rx="2.2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2.2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2.2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2.2"/></svg>`,
    sliders: `<svg ${S}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>`,
    list: `<svg ${S}><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1" fill="currentColor"/><circle cx="3.5" cy="12" r="1" fill="currentColor"/><circle cx="3.5" cy="18" r="1" fill="currentColor"/></svg>`,
    note: `<svg ${S}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
    ear: `<svg ${S}><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/></svg>`,
    synth: `<svg ${S}><rect x="2" y="6" width="20" height="13" rx="2.5"/><path d="M7 6v8M12 6v8M17 6v8"/></svg>`,
    alert: `<svg ${S}><path d="M12 8v5M12 17h.01"/><path d="M10.3 3.9 2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>`,
    side: `<svg ${S}><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>`,
    inspector: `<svg ${S}><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/></svg>`,
    search: `<svg ${S}><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`,
    expand: `<svg ${S}><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`,
    collapse: `<svg ${S}><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>`,
    close: `<svg ${S}><path d="M18 6 6 18M6 6l12 12"/></svg>`,
    chev: `<svg ${S}><path d="M9 6l6 6-6 6"/></svg>`,
    chevl: `<svg ${S}><path d="M15 6l-6 6 6 6"/></svg>`,
    chevd: `<svg ${S}><path d="M6 9l6 6 6-6"/></svg>`,
    check: `<svg ${S}><path d="M20 6 9 17l-5-5"/></svg>`,
    midi: `<svg ${S}><circle cx="12" cy="12" r="9"/><circle cx="8" cy="11" r="1" fill="currentColor"/><circle cx="16" cy="11" r="1" fill="currentColor"/><circle cx="12" cy="8" r="1" fill="currentColor"/><path d="M10 16h4"/></svg>`,
    undo: `<svg ${S}><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>`,
    info: `<svg ${S}><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/></svg>`,
    key: `<svg ${S}><circle cx="8" cy="15" r="5"/><path d="M12 11l9-9M17 6l3 3"/></svg>`,
    plus: `<svg ${S}><path d="M12 5v14M5 12h14"/></svg>`,
    minus: `<svg ${S}><path d="M5 12h14"/></svg>`,
    upload: `<svg ${S}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/></svg>`,
    sparkle: `<svg ${S}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>`,
    bookmark: `<svg ${S}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`,
    trash: `<svg ${S}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`,
    up: `<svg ${S}><path d="M18 15l-6-6-6 6"/></svg>`,
    down: `<svg ${S}><path d="M6 9l6 6 6-6"/></svg>`,
    more: `<svg ${F}><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>`,
    sun: `<svg ${S}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`,
    moon: `<svg ${S}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`,
    stage: `<svg ${S}><path d="M3 9V5a2 2 0 0 1 2-2h4M21 9V5a2 2 0 0 0-2-2h-4M3 15v4a2 2 0 0 0 2 2h4M21 15v4a2 2 0 0 1-2 2h-4"/><circle cx="12" cy="12" r="3"/></svg>`,
    keys: `<svg ${S}><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M7 5v9M12 5v9M17 5v9M7 14v5M12 14v5M17 14v5"/></svg>`,
    lyrics: `<svg ${S}><path d="M4 6h16M4 12h10M4 18h13"/></svg>`,
    qr: `<svg ${S}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3M21 14v.01M17 21h4v-4M14 21v-3"/></svg>`,
    copy: `<svg ${S}><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
    refresh: `<svg ${S}><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/></svg>`,
    fullscreen: `<svg ${S}><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>`,
    install: `<svg ${S}><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>`,
    eq: `<svg ${S}><path d="M2 12c3 0 3-6 6-6s3 12 6 12 3-6 8-6"/></svg>`,
    layers: `<svg ${S}><path d="M12 2l10 5-10 5L2 7z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    power: `<svg ${S}><path d="M18.4 6.6a9 9 0 1 1-12.8 0M12 2v10"/></svg>`,
    record: `<svg ${F}><circle cx="12" cy="12" r="6"/></svg>`,
    edit: `<svg ${S}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`,
    save: `<svg ${S}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>`,
    exit: `<svg ${S}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>`,
    speed: `<svg ${S}><path d="M12 14l4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/></svg>`,
    flat: `<svg ${S}><path d="M3 12h18"/></svg>`,
    tap: `<svg ${S}><path d="M9 11V5a2 2 0 1 1 4 0v5"/><path d="M13 10a2 2 0 1 1 4 0v2"/><path d="M17 12a2 2 0 1 1 4 0v3a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.4L5 15a2 2 0 0 1 3.4-2L9 14"/></svg>`,
    link: `<svg ${S}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>`,
  };
  LW.icons = I;
  LW.icon = (name) => I[name] || "";
  // Fill every [data-icon] placeholder once with its (static, trusted) SVG.
  LW.hydrateIcons = (scope) => {
    LW.$$("[data-icon]", scope).forEach((el) => {
      if (el._iconed) return;
      el._iconed = true;
      el.insertAdjacentHTML("afterbegin", LW.icon(el.dataset.icon));
    });
  };
})(typeof window !== "undefined" ? window : globalThis);
