/* Offline QR codes (phone-remote address). Wraps the vendored qrcode-generator (MIT, src/static/vendor/qrcode.js) and
   draws the symbol as an SVG built with DOM calls: black modules on a white quiet zone, always, so it scans in either theme. */
(function (root) {
  const LW = root.LW;
  const NS = "http://www.w3.org/2000/svg";
  const QUIET = 4; // modules of white border the QR spec asks for

  const matrix = (text, level) => {
    if (typeof root.qrcode !== "function") throw new Error("QR library is not loaded");
    const q = root.qrcode(0, level || "M"); // type 0 = smallest version that fits
    q.addData(String(text));
    q.make();
    const n = q.getModuleCount();
    const rows = [];
    for (let r = 0; r < n; r++) {
      const row = [];
      for (let c = 0; c < n; c++) row.push(Boolean(q.isDark(r, c)));
      rows.push(row);
    }
    return rows;
  };

  const el = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k]));
    return e;
  };

  const svg = (text, opts) => {
    const o = opts || {};
    const m = matrix(text, o.level);
    const size = m.length + QUIET * 2;
    let d = "";
    m.forEach((row, r) => row.forEach((on, c) => { if (on) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`; }));
    const s = el("svg", { viewBox: `0 0 ${size} ${size}`, role: "img", "aria-label": o.label || "QR code", "shape-rendering": "crispEdges" });
    s.appendChild(el("rect", { width: size, height: size, fill: "#fff" }));
    s.appendChild(el("path", { d, fill: "#000" }));
    return s;
  };

  LW.qr = { matrix, svg };
})(typeof window !== "undefined" ? window : globalThis);
