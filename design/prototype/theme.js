// Litwave redesign prototype — theme switching, toasts and icons shared by every page.
// Loaded in <head> so the saved theme is applied before first paint (no flash).
(function () {
  "use strict";

  var STORAGE_KEY = "litwave-theme";

  function readSaved() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }

  function systemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  var current = readSaved() || systemTheme();
  document.documentElement.setAttribute("data-theme", current);

  var ICONS = {
    studio: "M4 4h16v16H4z M4 10h16 M10 10v10",
    setlist: "M9 6h11 M9 12h11 M9 18h7 M4 6h.01 M4 12h.01 M4 18h.01",
    library: "M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0a3 3 0 0 1 6 0z M21 16a3 3 0 1 1-6 0a3 3 0 0 1 6 0z",
    pads: "M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z",
    drone: "M2 12c2-5 4-5 6 0s4 5 6 0 4-5 6 0 1.5 2 2 2",
    engine: "M3 5h18v14H3z M8 5v8 M12 5v8 M16 5v8 M3 13h18",
    mixer: "M6 4v16 M12 4v16 M18 4v16 M4 15h4 M10 8h4 M16 13h4",
    ear: "M4 15v-3a8 8 0 0 1 16 0v3 M4 15h3v5H4z M17 15h3v5h-3z",
    remote: "M7 3h10v18H7z M11 18h2",
    sun: "M12 16a4 4 0 1 0 0-8a4 4 0 0 0 0 8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4",
    moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
    panic: "M8 2h8l6 6v8l-6 6H8l-6-6V8z M12 8v5 M12 16h.01",
    upload: "M12 15V3 M7 8l5-5 5 5 M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4",
    sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
    jump: "M5 12h14 M13 6l6 6-6 6",
    check: "M5 12l5 5L20 7",
    search: "M11 18a7 7 0 1 0 0-14a7 7 0 0 0 0 14z M20 20l-3.5-3.5",
    play: "M7 4.5v15l12.5-7.5z",
    pause: "M6 5h4.5v14H6z M13.5 5H18v14h-4.5z"
  };

  function icon(name, size, filled) {
    var s = size || 16;
    return '<svg class="' + (filled ? "ico-fill" : "ico") + '" width="' + s + '" height="' + s +
      '" viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICONS[name] + '"></path></svg>';
  }

  function syncThemeControls() {
    document.querySelectorAll("[data-theme-set]").forEach(function (el) {
      var on = el.getAttribute("data-theme-set") === current;
      el.classList.toggle("is-active", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    });
    document.querySelectorAll("[data-theme-toggle]").forEach(function (el) {
      el.innerHTML = icon(current === "dark" ? "sun" : "moon", Number(el.getAttribute("data-icon-size")) || 17);
    });
  }

  function setTheme(theme) {
    current = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", current);
    try { localStorage.setItem(STORAGE_KEY, current); } catch (e) { /* storage unavailable: theme still applies */ }
    syncThemeControls();
  }

  var toastTimer = null;
  function toast(text) {
    var old = document.querySelector(".toast");
    if (old) old.remove();
    clearTimeout(toastTimer);
    var el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.innerHTML = icon("check", 16);
    el.appendChild(document.createTextNode(text));
    document.body.appendChild(el);
    toastTimer = setTimeout(function () {
      el.classList.add("is-leaving");
      el.addEventListener("animationend", function () { el.remove(); }, { once: true });
    }, 2400);
  }

  // Re-trigger a CSS animation on an element (e.g. when the chord changes).
  function replay(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  document.addEventListener("click", function (e) {
    var set = e.target.closest("[data-theme-set]");
    if (set) { setTheme(set.getAttribute("data-theme-set")); return; }
    if (e.target.closest("[data-theme-toggle]")) setTheme(current === "dark" ? "light" : "dark");
  });

  document.addEventListener("DOMContentLoaded", syncThemeControls);

  window.Lit = {
    icon: icon,
    toast: toast,
    replay: replay,
    setTheme: setTheme,
    getTheme: function () { return current; },
    toggleTheme: function () { setTheme(current === "dark" ? "light" : "dark"); }
  };
})();
