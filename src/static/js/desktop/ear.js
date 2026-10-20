/* Ear training: chord quality, progressions, melodic response, relative intervals. Score + streak from the server. */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);
  let mod = "chord_quality", locked = false, sheet = null;

  const post = (body) => LW.api.post("/api/ear-training", body);
  function score(s) { if (s) LW.setText($("earScore"), `${s.correct}/${s.total} · streak ${s.streak}`); }

  async function load() {
    locked = false;
    const fb = $("earFeedback");
    LW.setText(fb, ""); fb.className = "ear-fb";
    LW.setText($("earQuestion"), "Playing a new exercise on the sound engine…");
    const grid = $("earChoices");
    grid.textContent = "";
    try {
      const data = await post({ action: "generate", module: mod });
      if (!data || !data.exercise) return;
      LW.setText($("earQuestion"), data.exercise.question || "Listen and choose");
      score(data.score);
      if (data.exercise.choices) {
        data.exercise.choices.forEach((c) => {
          const b = LW.h("button", { class: "ear-choice", type: "button", "data-press": "sink" },
            LW.h("b", { text: c.label || c.nashville || c.id }), LW.h("em", { text: c.abbr || c.roman || c.deg || "" }));
          b.addEventListener("click", () => check(c.id));
          grid.append(b);
        });
        LW.ui.press(grid);
      } else if (mod === "melodic_response") {
        grid.append(LW.h("div", { class: "ear-hint", text: "Listen to the phrase, then play it back on your keyboard." }));
      }
    } catch (e) {
      LW.setText($("earQuestion"), "Couldn't create an exercise. Is the sound engine running?");
    }
  }

  async function check(id) {
    if (locked) return;
    locked = true;
    try {
      const data = await post({ action: "check", answer: id });
      const fb = $("earFeedback");
      if (data.is_correct) { fb.className = "ear-fb ok"; LW.setText(fb, "Correct. Nice ear."); }
      else { fb.className = "ear-fb bad"; LW.setText(fb, `Not quite. The answer was ${data.correct_answer}.`); }
      score(data.score);
    } catch (_) { locked = false; }
  }

  LW.ear = { load, check, replay: () => post({ action: "replay" }).catch(() => {}) };

  LW.on("ready", () => {
    sheet = LW.sheet($("sheetEar"));
    LW.registerSheet("ear", sheet, load);
    LW.ui.tabs($("earTabs"), (i, k) => { mod = k; load(); });
    $("earReplay").addEventListener("click", () => LW.ear.replay());
    $("earNext").addEventListener("click", load);
  });
})(window);
