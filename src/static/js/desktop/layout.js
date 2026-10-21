/* Studio layout: icons, collapsible sidebar/inspector, island placement, panel expand, engine popover, menu. */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);
  const app = $("app");


  const setIcon = (id, name) => { const el = $(id); if (el) el.innerHTML = LW.icon(name); };

  LW.layout = {
    init() {
      setIcon("btnSidebar", "side");
      setIcon("btnInspector", "inspector");
      setIcon("btnRewind", "rew");
      $("btnPlay").innerHTML = `<span class="pp">${LW.icon("play")}${LW.icon("pause")}</span>`;
      setIcon("btnLoop", "loop");
      setIcon("btnLoopReset", "close");
      setIcon("tbMetro", "metro");
      setIcon("tbRemote", "qr");
      setIcon("tbMenu", "more");
      setIcon("sbNewSetlist", "plus");
      setIcon("sbSetlistManage", "list");
      setIcon("sbUpload", "upload");
      $("sbAddSong").innerHTML = `${LW.icon("plus")}<span>Add song</span>`;
      LW.$$("[data-expand]").forEach((b) => { b.innerHTML = LW.icon("expand"); });
      LW.$$("[data-close]").forEach((b) => { if (b.classList.contains("ib")) b.innerHTML = LW.icon("close"); });
      const logo = document.querySelector(".logo"); if (logo) logo.innerHTML = LW.icon("wave");
      LW.hydrateIcons(document);
      this.themeButton();
      this.collapsers();
      this.island();
      this.expanders();
      this.popover();
      this.menu();
      LW.ui.press(document);
    },

    themeButton() {
      const paint = () => {
        const icon = LW.theme.current() === "dark" ? "sun" : "moon";
        ["btnTheme", "stgTheme"].forEach((id) => setIcon(id, icon));
      };
      ["btnTheme", "stgTheme"].forEach((id) => { const b = $(id); if (b) b.addEventListener("click", () => LW.theme.toggle()); });
      LW.on("theme", paint);
      paint();
    },

    /* Sidebar and inspector widths spring open/closed. Narrow windows start with them collapsed. */
    collapsers() {
      const W = { sb: 256, in: 316 };
      const open = { sb: root.innerWidth >= 1180, in: root.innerWidth >= 1360 };
      const sbs = LW.spring(open.sb ? W.sb : 0, { response: 0.45, damping: 0.9, eps: 0.3 }, (v) => {
        app.style.setProperty("--sbw", Math.max(0, v) + "px");
        app.style.setProperty("--sbo", LW.clamp(v / W.sb, 0, 1));
        LW.emit("layout");
      });
      const ins = LW.spring(open.in ? W.in : 0, { response: 0.45, damping: 0.9, eps: 0.3 }, (v) => {
        app.style.setProperty("--inw", Math.max(0, v) + "px");
        app.style.setProperty("--ino", LW.clamp(v / W.in, 0, 1));
        LW.emit("layout");
      });
      sbs.set(sbs.x); ins.set(ins.x);
      const paint = () => {
        $("btnSidebar").setAttribute("aria-pressed", open.sb ? "true" : "false");
        $("btnInspector").setAttribute("aria-pressed", open.in ? "true" : "false");
        $("sidebar").setAttribute("aria-hidden", open.sb ? "false" : "true");
        $("inspector").setAttribute("aria-hidden", open.in ? "false" : "true");
      };
      paint();
      LW.layout.toggleSidebar = (v) => { open.sb = v == null ? !open.sb : !!v; sbs.to(open.sb ? W.sb : 0); paint(); };
      LW.layout.toggleInspector = (v) => { open.in = v == null ? !open.in : !!v; ins.to(open.in ? W.in : 0); paint(); };
      $("btnSidebar").addEventListener("click", () => LW.layout.toggleSidebar());
      $("btnInspector").addEventListener("click", () => LW.layout.toggleInspector());
      let lastW = root.innerWidth;
      root.addEventListener("resize", () => {
        const w = root.innerWidth;
        if (lastW >= 1360 && w < 1360) LW.layout.toggleInspector(false);
        if (lastW < 1360 && w >= 1360) LW.layout.toggleInspector(true);
        if (lastW >= 1180 && w < 1180) LW.layout.toggleSidebar(false);
        if (lastW < 1180 && w >= 1180) LW.layout.toggleSidebar(true);
        lastW = w;
      });
    },

    /* The island floats over the toolbar's free centre in Studio and the screen centre in Stage. */
    island() {
      const host = $("islandHost");
      const tb = $("toolbar");
      const place = () => {
        if (document.body.classList.contains("staging")) { host.style.left = "50%"; host.style.top = "16px"; return; }
        const r = tb.getBoundingClientRect();
        const tp = $("transport").getBoundingClientRect();
        const right = $("btnStage").getBoundingClientRect();
        const centre = (tp.right + right.left) / 2;
        host.style.left = Math.round(centre || r.left + r.width / 2) + "px";
        host.style.top = Math.round(r.top + (r.height - 40) / 2) + "px";
      };
      LW.layout.placeIsland = place;
      LW.on("layout", place);
      root.addEventListener("resize", place);
      if (root.ResizeObserver) new root.ResizeObserver(place).observe(tb);
      place();
    },

    /* Expand a panel to fill the main area with a spring; Esc or the button returns it.
       While expanded the panel lives in <body> (so the dimmed layout can't fade it) and a hidden placeholder
       keeps its slot. On the way back the panel is only put home once its springs have come to rest, and the
       springs are stopped first so they can never write a stale position onto the settled panel. */
    expanders() {
      const main = $("main");
      let cur = null;      // panel currently expanded
      let closing = null;  // panel animating home: { panel, home, springs, timer }
      const rect = (el) => el.getBoundingClientRect();
      const put = (el, b) => Object.assign(el.style, { left: b.x + "px", top: b.y + "px", width: b.w + "px", height: b.h + "px" });
      const KEYS = ["x", "y", "w", "h"];

      const finish = (c) => {
        clearInterval(c.timer);
        c.springs.forEach((s) => s.set(s.target)); // lands on the placeholder's box and stops the spring
        c.panel.classList.remove("expanded");
        c.panel.style.left = c.panel.style.top = c.panel.style.width = c.panel.style.height = "";
        if (c.home.parentNode) { c.home.parentNode.insertBefore(c.panel, c.home); c.home.remove(); }
        if (closing === c) closing = null;
        LW.emit("panel-expand", c.panel.id, false);
      };
      const atRest = (c) => c.springs.every((s) => Math.abs(s.x - s.target) < 0.6 && Math.abs(s.v) < 8);

      const setButton = (panel, on) => {
        const b = panel.querySelector("[data-expand]");
        if (b) { b.innerHTML = LW.icon(on ? "collapse" : "expand"); b.setAttribute("aria-label", on ? "Restore panel" : "Expand panel"); }
      };

      const expand = (panel) => {
        if (cur) return collapse();
        const m = rect(main);
        let c;
        if (closing && closing.panel === panel) {
          // Re-expanded while still gliding home: carry on from where it is, with the same placeholder.
          clearInterval(closing.timer);
          c = closing; closing = null;
        } else {
          if (closing) finish(closing); // another panel is still settling: put it home first
          const r = rect(panel);
          const home = document.createElement("div");
          home.className = panel.className.replace("panel", "panel-ph");
          home.style.cssText = `width:${r.width}px;height:${r.height}px;visibility:hidden`;
          panel.parentNode.insertBefore(home, panel);
          const box = { x: r.left, y: r.top, w: r.width, h: r.height };
          document.body.appendChild(panel); // lift out of the dimmed layout while expanded
          panel.classList.add("expanded");
          put(panel, box);
          const springs = KEYS.map((k) => LW.spring(box[k], { response: 0.5, damping: 0.86, eps: 0.3 }, (v) => {
            if (!panel.classList.contains("expanded")) return;
            box[k] = v; put(panel, box);
          }));
          c = { panel, home, springs, timer: null };
        }
        main.classList.add("has-expanded");
        const tgt = { x: m.left, y: m.top, w: m.width, h: m.height };
        KEYS.forEach((k, i) => c.springs[i].to(tgt[k], { response: 0.5, damping: 0.86 }));
        setButton(panel, true);
        cur = c;
        LW.emit("panel-expand", panel.id, true);
      };

      const collapse = () => {
        if (!cur) return false;
        const c = cur;
        const r = rect(c.home);
        const tgt = { x: r.left, y: r.top, w: r.width, h: r.height };
        KEYS.forEach((k, i) => c.springs[i].to(tgt[k], { response: 0.45, damping: 0.95 }));
        main.classList.remove("has-expanded");
        setButton(c.panel, false);
        cur = null;
        closing = c;
        const t0 = performance.now();
        c.timer = setInterval(() => { if (atRest(c) || performance.now() - t0 > 1800) finish(c); }, 40);
        return true;
      };
      LW.layout.collapsePanel = collapse;
      LW.$$("[data-expand]").forEach((b) => b.addEventListener("click", () => expand($(b.dataset.expand))));
    },

    popover() {
      const pop = $("enginePopover"), btn = $("engineStatusBtn");
      const close = () => pop.classList.remove("open");
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (pop.classList.contains("open")) return close();
        const r = btn.getBoundingClientRect();
        pop.style.left = Math.round(r.left) + "px";
        pop.style.top = Math.round(r.top - 8) + "px";
        pop.style.transform = "translateY(-100%)";
        pop.classList.add("open");
        LW.emit("engine-popover");
      });
      document.addEventListener("click", (e) => { if (!pop.contains(e.target)) close(); });
      LW.layout.closePopover = () => { const was = pop.classList.contains("open"); close(); return was; };
    },

    menu() {
      LW.ui.menu($("tbMenu"), () => [
        { icon: "stage", label: "Stage mode", onClick: () => LW.stage && LW.stage.enter() },
        "sep",
        { icon: "grid", label: "FX pads", onClick: () => LW.openSheet("fxpads") },
        { icon: "wave", label: "Drone pad", onClick: () => LW.openSheet("drone") },
        { icon: "sliders", label: "Parts mixer", onClick: () => LW.openSheet("parts") },
        { icon: "list", label: "Setlists & library", onClick: () => LW.openSheet("setlist") },
        { icon: "ear", label: "Ear training", onClick: () => LW.openSheet("ear") },
        { icon: "synth", label: "Sound engine", onClick: () => LW.openSheet("engine") },
        { icon: "qr", label: "Phone remote", onClick: () => LW.openSheet("remote") },
        "sep",
        { icon: LW.theme.current() === "dark" ? "sun" : "moon", label: LW.theme.current() === "dark" ? "Light appearance" : "Dark appearance", onClick: () => LW.theme.toggle() },
        { icon: "gear", label: "Preferences", onClick: () => LW.openSheet("prefs") },
        { icon: "link", label: "Classic interface", onClick: () => { root.location.href = "/static/classic/index.html"; } },
      ]);
    },
  };

  /* Sheet registry: feature modules register their sheet; everyone opens them by name. */
  const registry = {};
  LW.registerSheet = (name, api, onOpen) => { registry[name] = { api, onOpen }; };
  LW.openSheet = (name, origin) => {
    const r = registry[name];
    if (!r) return;
    if (r.onOpen) r.onOpen();
    r.api.open(origin);
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-open]");
    if (b) LW.openSheet(b.dataset.open, b);
  });
})(window);
