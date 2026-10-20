/* Springs (damping ratio + response, Apple-style) and the shared frame loop. */
(function (root) {
  const LW = root.LW;
  const active = new Set();
  const frameFns = new Set();
  let running = false;
  let last = 0;

  function loop(t) {
    const dt = Math.min(0.05, (t - (last || t)) / 1000);
    last = t;
    for (const s of Array.from(active)) if (!s.step(dt)) active.delete(s);
    for (const fn of Array.from(frameFns)) {
      try { fn(dt, t); } catch (e) { console.error("[LW] frame handler failed:", e); }
    }
    if (active.size || frameFns.size) root.requestAnimationFrame(loop);
    else { running = false; last = 0; }
  }
  function kick() {
    if (running || typeof root.requestAnimationFrame !== "function") return;
    running = true;
    root.requestAnimationFrame(loop);
  }

  class Spring {
    constructor(x, o, cb) {
      o = o || {};
      this.x = x; this.v = 0; this.target = x; this.cb = cb || null;
      this.eps = o.eps != null ? o.eps : 0.01;
      this.cfg(o.response != null ? o.response : 0.4, o.damping != null ? o.damping : 1);
    }
    cfg(response, damping) {
      this.r = response; this.d = damping;
      this.k = Math.pow((2 * Math.PI) / response, 2);
      this.c = (4 * Math.PI * damping) / response;
      return this;
    }
    to(target, o) {
      o = o || {};
      if (o.response != null || o.damping != null) this.cfg(o.response != null ? o.response : this.r, o.damping != null ? o.damping : this.d);
      if (o.velocity != null) this.v = o.velocity;
      this.target = target;
      active.add(this);
      kick();
      return this;
    }
    set(x) {
      this.x = this.target = x; this.v = 0;
      active.delete(this);
      if (this.cb) this.cb(x, 0);
      return this;
    }
    step(dt) {
      const n = Math.max(1, Math.ceil(dt * 240));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        const a = -this.k * (this.x - this.target) - this.c * this.v;
        this.v += a * h;
        this.x += this.v * h;
      }
      const done = Math.abs(this.v) < this.eps * 6 && Math.abs(this.x - this.target) < this.eps;
      if (done) { this.x = this.target; this.v = 0; }
      if (this.cb) this.cb(this.x, this.v);
      return !done;
    }
  }

  LW.spring = (x, o, cb) => new Spring(x, o, cb);
  LW.onFrame = (fn) => { frameFns.add(fn); kick(); return () => frameFns.delete(fn); };
  // Where a flick would come to rest (Apple's deceleration projection).
  LW.project = (velocity, rate) => {
    const d = rate == null ? 0.998 : rate;
    return ((velocity / 1000) * d) / (1 - d);
  };
  // Progressive resistance past a boundary.
  LW.rubber = (over, dim, c) => {
    const k = c == null ? 0.55 : c;
    return (over * dim * k) / (dim + k * Math.abs(over));
  };
  LW.reducedMotion = () => !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
})(typeof window !== "undefined" ? window : globalThis);
