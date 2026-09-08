(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.BrowserApi = api;
    // ponytail: flat global exports simplify inline script migration; namespace when frontend adopts modules
    if (!root.requestJson) root.requestJson = api.requestJson;
    if (!root.getJson) root.getJson = api.getJson;
    if (!root.postJson) root.postJson = api.postJson;
    if (!root.resolveCssToken) root.resolveCssToken = api.resolveCssToken;
    if (!root.formatTime) root.formatTime = api.formatTime;
    if (!root.formatTimeWithMs) root.formatTimeWithMs = api.formatTimeWithMs;
    if (!root.FX_PAD_PALETTE) root.FX_PAD_PALETTE = api.FX_PAD_PALETTE;
    if (!root.animateFxPadPulse) root.animateFxPadPulse = api.animateFxPadPulse;
    if (!root.createToastHelper) root.createToastHelper = api.createToastHelper;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  // 8 Vivid Hardware MPC/SP-404 Style RGB Pad Colors (Index 0..7)
  const FX_PAD_PALETTE = [
    { bg: "linear-gradient(135deg, rgba(239, 68, 68, 0.25) 0%, rgba(185, 28, 28, 0.4) 100%)", border: "#ef4444", glow: "rgba(239, 68, 68, 0.4)" },     // 1: Red
    { bg: "linear-gradient(135deg, rgba(249, 115, 22, 0.25) 0%, rgba(194, 65, 12, 0.4) 100%)", border: "#f97316", glow: "rgba(249, 115, 22, 0.4)" },   // 2: Orange
    { bg: "linear-gradient(135deg, rgba(234, 179, 8, 0.25) 0%, rgba(161, 98, 7, 0.4) 100%)", border: "#eab308", glow: "rgba(234, 179, 8, 0.4)" },      // 3: Amber/Gold
    { bg: "linear-gradient(135deg, rgba(34, 197, 94, 0.25) 0%, rgba(21, 128, 61, 0.4) 100%)", border: "#22c55e", glow: "rgba(34, 197, 94, 0.4)" },     // 4: Green
    { bg: "linear-gradient(135deg, rgba(6, 182, 212, 0.25) 0%, rgba(14, 116, 144, 0.4) 100%)", border: "#06b6d4", glow: "rgba(6, 182, 212, 0.4)" },     // 5: Cyan
    { bg: "linear-gradient(135deg, rgba(59, 130, 246, 0.25) 0%, rgba(29, 78, 216, 0.4) 100%)", border: "#3b82f6", glow: "rgba(59, 130, 246, 0.4)" },     // 6: Blue
    { bg: "linear-gradient(135deg, rgba(168, 85, 247, 0.25) 0%, rgba(126, 34, 206, 0.4) 100%)", border: "#a855f7", glow: "rgba(168, 85, 247, 0.4)" },   // 7: Purple
    { bg: "linear-gradient(135deg, rgba(236, 72, 153, 0.25) 0%, rgba(190, 24, 93, 0.4) 100%)", border: "#ec4899", glow: "rgba(236, 72, 153, 0.4)" }     // 8: Pink / Magenta
  ];

  function formatTime(sec, options = {}) {
    const showMs = typeof options === "boolean" ? options : Boolean(options && options.showMs);
    const num = Number(sec);
    if (!Number.isFinite(num) || num <= 0) return showMs ? "00:00.00" : "00:00";
    const m = Math.floor(num / 60);
    const s = Math.floor(num % 60);
    const base = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    if (!showMs) return base;
    const ms = Math.floor((num % 1) * 100);
    return `${base}.${String(ms).padStart(2, "0")}`;
  }

  function formatTimeWithMs(sec) {
    return formatTime(sec, { showMs: true });
  }

  function resolveCssToken(token, fallback = "", targetElement = null) {
    if (!token || typeof token !== "string") return fallback;
    const trimmed = token.trim();
    const varMatch = trimmed.match(/^var\(\s*(--[a-zA-Z0-9_-]+)(?:\s*,\s*(.+))?\s*\)$/);
    const propName = varMatch ? varMatch[1] : (trimmed.startsWith("--") ? trimmed : null);
    if (!propName) return trimmed;

    if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
      try {
        const rootEl = targetElement || (typeof document !== "undefined" ? document.documentElement : null);
        if (rootEl) {
          const val = window.getComputedStyle(rootEl).getPropertyValue(propName);
          if (val && val.trim()) return val.trim();
        }
      } catch (_) {}
    }
    if (varMatch && varMatch[2]) return varMatch[2].trim();
    return fallback;
  }

  async function requestJson(url, options = {}) {
    const { headers: userHeaders, body, method = "GET", ...rest } = options;
    const headers = { ...(userHeaders || {}) };
    let payload = body;

    if (payload !== undefined && payload !== null && typeof payload === "object" && !(typeof FormData !== "undefined" && payload instanceof FormData)) {
      if (!headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
      payload = JSON.stringify(payload);
    }

    const fetchFn = typeof fetch !== "undefined" ? fetch : (typeof globalThis !== "undefined" ? globalThis.fetch : null);
    if (!fetchFn) throw new Error("fetch is not defined in this environment");

    const res = await fetchFn(url, {
      method,
      headers,
      body: payload,
      ...rest
    });

    let data = null;
    const contentType = res.headers && typeof res.headers.get === "function" ? res.headers.get("content-type") : "";
    if (contentType && contentType.includes("application/json")) {
      try {
        data = await res.json();
      } catch (_) {
        data = null;
      }
    } else {
      try {
        data = await res.json();
      } catch (_) {
        try {
          data = await res.text();
        } catch (_) {
          data = null;
        }
      }
    }

    if (!res.ok) {
      const errMsg = (data && typeof data === "object" && (data.error || data.detail || data.message))
        ? (data.error || data.detail || data.message)
        : `HTTP ${res.status}: ${res.statusText || "Request failed"}`;
      const error = new Error(errMsg);
      error.status = res.status;
      error.data = data;
      error.response = res;
      throw error;
    }

    return data;
  }

  function getJson(url, options = {}) {
    return requestJson(url, { ...options, method: "GET" });
  }

  function postJson(url, body = {}, options = {}) {
    return requestJson(url, { ...options, method: "POST", body });
  }

  function animateFxPadPulse(padEl, padIndex, palette = FX_PAD_PALETTE, durationMs = 140) {
    if (!padEl || !Array.isArray(palette) || palette.length === 0) return;
    const idx = typeof padIndex === "number" ? Math.abs(padIndex) : 0;
    const padColor = palette[idx % palette.length];
    if (padEl.style) {
      padEl.style.background = padColor.border;
      padEl.style.boxShadow = `0 0 20px ${padColor.glow}`;
      setTimeout(() => {
        if (padEl && padEl.style) {
          padEl.style.background = padColor.bg;
          padEl.style.boxShadow = "none";
        }
      }, durationMs);
    }
  }

  function createToastHelper(elementId, timerKey = "_toastTimer") {
    return function showToast(msg, durationMs = 2500) {
      if (typeof document === "undefined") return;
      const toast = document.getElementById(elementId);
      if (!toast) return;
      toast.innerText = msg;
      toast.style.opacity = "1";
      const root = typeof window !== "undefined" ? window : globalThis;
      clearTimeout(root[timerKey]);
      root[timerKey] = setTimeout(() => {
        toast.style.opacity = "0";
      }, durationMs);
    };
  }

  return {
    FX_PAD_PALETTE,
    formatTime,
    formatTimeWithMs,
    resolveCssToken,
    requestJson,
    getJson,
    postJson,
    animateFxPadPulse,
    createToastHelper
  };
});
