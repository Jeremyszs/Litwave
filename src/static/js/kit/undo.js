/* Undo for destructive actions. One slot: the latest action only, available for a few seconds.
   push() raises a Dynamic Island alert with an Undo button; Ctrl/Cmd+Z (desktop) does the same thing. */
(function (root) {
  const LW = root.LW;
  let entry = null, timer = null;

  const clear = () => { clearTimeout(timer); timer = null; entry = null; };

  LW.undo = {
    ttl: 8000, // how long Undo stays available (ms)
    get available() { return entry !== null; },
    /** push({ label, sub, icon, run }): `run` puts things back; it may be async. */
    push(o) {
      clear();
      entry = { label: String(o.label || "Action"), run: o.run };
      timer = setTimeout(clear, LW.undo.ttl);
      LW.alert({ icon: o.icon || "undo", title: entry.label, sub: o.sub, action: { label: "Undo", run: () => LW.undo.run() } }, LW.undo.ttl);
    },
    /** Undo the latest action. Returns false when there is nothing (left) to undo. */
    run() {
      if (!entry) return false;
      const e = entry;
      clear();
      let result;
      try { result = e.run(); } catch (_) { result = Promise.reject(); }
      Promise.resolve(result).then(
        () => LW.alert({ icon: "undo", tone: "ok", title: "Undone", sub: e.label }, 1600),
        () => LW.alert({ icon: "alert", tone: "bad", title: "Couldn't undo", sub: e.label }, 2600),
      );
      return true;
    },
    clear,
  };
})(typeof window !== "undefined" ? window : globalThis);
