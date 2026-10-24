(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const pad = (n) => String(n).padStart(2, "0");
  const uid = () => Math.random().toString(36).slice(2, 9);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const store = {
    get(k, d) { try { const v = localStorage.getItem("sd:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("sd:" + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };

  /* ------------------------------------------------------------------ tabs */
  const tabs = $$('[role="tab"]');
  function showTab(id) {
    tabs.forEach((t) => {
      const on = t.id === id;
      t.setAttribute("aria-selected", on);
      $("#" + t.getAttribute("aria-controls")).hidden = !on;
    });
    store.set("tab", id);
  }
  tabs.forEach((t) => t.addEventListener("click", () => showTab(t.id)));
  showTab(store.get("tab", "t-focus"));

  /* ------------------------------------------------------------- flip digits */
  function makeFlip(host, pattern) {
    host.classList.add("flipgroup");
    const digits = [];
    for (const ch of pattern) {
      if (ch === "d") {
        const el = document.createElement("div");
        el.className = "flip";
        el.dataset.v = "";
        el.innerHTML =
          '<div class="half top"><span></span></div><div class="half bot"><span></span></div>' +
          '<div class="half top lf"><span></span></div><div class="half bot lf"><span></span></div>';
        host.appendChild(el);
        digits.push(el);
      } else {
        const s = document.createElement("div");
        s.className = "sep";
        s.setAttribute("aria-hidden", "true");
        s.innerHTML = "<i></i><i></i>";
        host.appendChild(s);
      }
    }
    const spans = (el) => $$("span", el); // [new top, old bottom, leaf top, leaf bottom]
    function setDigit(el, v, animate) {
      const old = el.dataset.v;
      if (old === v) return;
      const [sTop, sBot, lTop, lBot] = spans(el);
      clearTimeout(el._t);
      if (!animate || old === "" || reduceMotion) {
        spans(el).forEach((s) => (s.textContent = v));
        el.classList.remove("go");
        el.dataset.v = v;
        return;
      }
      sTop.textContent = v; sBot.textContent = old;
      lTop.textContent = old; lBot.textContent = v;
      el.classList.remove("go");
      void el.offsetWidth; // restart the CSS animation
      el.classList.add("go");
      el.dataset.v = v;
      el._t = setTimeout(() => { spans(el).forEach((s) => (s.textContent = v)); el.classList.remove("go"); }, 650);
    }
    return { set(str, animate = true) { [...str].forEach((c, i) => digits[i] && setDigit(digits[i], c, animate)); } };
  }

  /* ------------------------------------------------------------------ clock */
  const clock = makeFlip($("#clock"), "dd:dd:dd");
  let is24 = store.get("is24", false);
  let clockFirst = true;
  function tickClock() {
    const d = new Date();
    let h = d.getHours();
    const suffix = h >= 12 ? "pm" : "am";
    if (!is24) h = h % 12 || 12;
    clock.set(pad(h) + pad(d.getMinutes()) + pad(d.getSeconds()), !clockFirst);
    clockFirst = false;
    $("#dateLine").textContent = d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }) + (is24 ? "" : " · " + suffix);
    $("#btnFmt").textContent = is24 ? "24h" : "12h";
  }
  $("#btnFmt").addEventListener("click", () => { is24 = !is24; store.set("is24", is24); tickClock(); });
  tickClock();
  setInterval(tickClock, 250);

  /* ------------------------------------------------------------------ timer */
  const timerFlip = makeFlip($("#timerFlip"), "dd:dd");
  const T = {
    mode: "focus", running: false, endAt: 0, remaining: 0, cycle: store.get("cycle", 0), lastTick: 0,
    cfg: store.get("cfg", { focus: 25, short: 5, long: 15, auto: false }),
  };
  const MODE_NAME = { focus: "Focus", short: "Short break", long: "Long break" };
  const dayKey = () => new Date().toISOString().slice(0, 10);
  let today = store.get("today", { day: dayKey(), ms: 0 });
  if (today.day !== dayKey()) today = { day: dayKey(), ms: 0 };

  const modeMs = (m) => T.cfg[m] * 60000;
  function fmtToday() {
    const m = Math.floor(today.ms / 60000);
    $("#todayTotal").textContent = m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  }
  function drawTimer(animate = true) {
    const secs = Math.max(0, Math.ceil((T.running ? T.endAt - Date.now() : T.remaining) / 1000));
    const txt = pad(Math.floor(secs / 60)) + pad(secs % 60);
    timerFlip.set(txt, animate);
    document.title = T.running ? `${txt.slice(0, 2)}:${txt.slice(2)} · ${MODE_NAME[T.mode]} · StudyDesk` : "StudyDesk";
  }
  function drawDots() {
    $$("#dots i").forEach((d, i) => d.classList.toggle("on", i < T.cycle % 4 || (T.cycle > 0 && T.cycle % 4 === 0 && T.mode === "long")));
  }
  function setMode(m, autostart = false) {
    T.mode = m; T.running = false; T.remaining = modeMs(m);
    $$(".modes button").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
    $("#btnStart").textContent = "Start";
    drawTimer(); drawDots();
    if (autostart) start();
  }
  function start() {
    if (T.running) return;
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    T.running = true; T.endAt = Date.now() + T.remaining; T.lastTick = Date.now();
    $("#btnStart").textContent = "Pause";
  }
  function pause() {
    if (!T.running) return;
    T.remaining = Math.max(0, T.endAt - Date.now()); T.running = false;
    $("#btnStart").textContent = "Resume";
    saveToday(); drawTimer(false);
  }
  function saveToday() { store.set("today", today); store.set("cycle", T.cycle); fmtToday(); }
  function beep() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.25, 0.5].forEach((t, i) => {
        const o = ac.createOscillator(), g = ac.createGain(), t0 = ac.currentTime + t;
        o.frequency.value = i === 2 ? 988 : 784;
        o.connect(g); g.connect(ac.destination);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
        o.start(t0); o.stop(t0 + 0.24);
      });
    } catch { /* audio blocked */ }
  }
  function finish() {
    const wasFocus = T.mode === "focus";
    T.running = false;
    beep();
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(wasFocus ? "Focus round done" : "Break over", { body: wasFocus ? "Time for a break." : "Ready for the next round?" });
    }
    if (wasFocus) T.cycle++;
    saveToday();
    const next = wasFocus ? (T.cycle % 4 === 0 ? "long" : "short") : "focus";
    setMode(next, T.cfg.auto);
  }
  function tickTimer() {
    if (!T.running) return;
    const now = Date.now();
    if (T.mode === "focus") { today.ms += now - T.lastTick; if (Math.floor(now / 15000) !== Math.floor(T.lastTick / 15000)) saveToday(); }
    T.lastTick = now;
    if (T.endAt - now <= 0) { drawTimer(); finish(); return; }
    drawTimer();
  }
  setInterval(tickTimer, 200);
  addEventListener("beforeunload", () => { if (T.running) { today.ms += Date.now() - T.lastTick; } store.set("today", today); });

  $("#btnStart").addEventListener("click", () => (T.running ? pause() : start()));
  $("#btnReset").addEventListener("click", () => { pause(); setMode(T.mode); });
  $("#btnSkip").addEventListener("click", () => { pause(); const wasFocus = T.mode === "focus"; if (wasFocus) T.cycle++; saveToday(); setMode(wasFocus ? (T.cycle % 4 === 0 ? "long" : "short") : "focus"); });
  $$(".modes button").forEach((b) => b.addEventListener("click", () => { pause(); setMode(b.dataset.mode); }));
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement.tagName) && !$("#tab-focus").hidden) { e.preventDefault(); T.running ? pause() : start(); }
  });

  ["Focus", "Short", "Long"].forEach((n) => {
    const el = $("#set" + n), k = n.toLowerCase();
    el.value = T.cfg[k];
    el.addEventListener("change", () => {
      T.cfg[k] = Math.min(99, Math.max(1, parseInt(el.value, 10) || T.cfg[k])); el.value = T.cfg[k];
      store.set("cfg", T.cfg);
      if (!T.running && T.mode === k) setMode(k);
    });
  });
  $("#setAuto").checked = T.cfg.auto;
  $("#setAuto").addEventListener("change", (e) => { T.cfg.auto = e.target.checked; store.set("cfg", T.cfg); });
  $("#taskLabel").value = store.get("task", "");
  $("#taskLabel").addEventListener("input", (e) => store.set("task", e.target.value));

  T.remaining = modeMs("focus");
  drawTimer(false); drawDots(); fmtToday();

  /* -------------------------------------------------------------- timetable */
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const COLORS = ["#2f4bff", "#e4572e", "#12a594", "#b5179e", "#f2a900", "#2d8f3c", "#7a5af8", "#d62e79"];
  const defaultPlan = () => ({
    subjects: [
      { id: uid(), name: "Physics", priority: 4, color: COLORS[0] },
      { id: uid(), name: "Chemistry", priority: 3, color: COLORS[1] },
      { id: uid(), name: "Mathematics", priority: 5, color: COLORS[2] },
      { id: uid(), name: "English", priority: 2, color: COLORS[3] },
    ],
    settings: { days: [1, 1, 1, 1, 1, 1, 0], start: "17:00", hours: 3, session: 45, brk: 10 },
    schedule: {},
  });
  const plan = store.get("plan", null) || defaultPlan();
  const savePlan = () => store.set("plan", plan);
  const subj = (id) => plan.subjects.find((s) => s.id === id);
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

  function renderSubjects() {
    $("#subjectList").innerHTML = plan.subjects.map((s) => `
      <div class="subj" data-id="${s.id}">
        <input type="color" value="${s.color}" aria-label="Colour for ${esc(s.name)}">
        <input type="text" value="${esc(s.name)}" maxlength="30" aria-label="Subject name" placeholder="Subject">
        <select aria-label="Priority for ${esc(s.name)}">
          ${[1, 2, 3, 4, 5].map((p) => `<option value="${p}" ${p === s.priority ? "selected" : ""}>${["", "Low", "Fair", "Mid", "High", "Top"][p]}</option>`).join("")}
        </select>
        <button class="x" aria-label="Remove ${esc(s.name)}">×</button>
      </div>`).join("");
  }
  $("#subjectList").addEventListener("input", (e) => {
    const row = e.target.closest(".subj"); if (!row) return;
    const s = subj(row.dataset.id);
    if (e.target.type === "color") s.color = e.target.value;
    else if (e.target.type === "text") s.name = e.target.value;
    savePlan(); renderWeek();
  });
  $("#subjectList").addEventListener("change", (e) => {
    const row = e.target.closest(".subj"); if (!row || e.target.tagName !== "SELECT") return;
    subj(row.dataset.id).priority = +e.target.value; savePlan();
  });
  $("#subjectList").addEventListener("click", (e) => {
    if (!e.target.classList.contains("x")) return;
    const id = e.target.closest(".subj").dataset.id;
    plan.subjects = plan.subjects.filter((s) => s.id !== id);
    Object.keys(plan.schedule).forEach((d) => (plan.schedule[d] = plan.schedule[d].filter((b) => b.sid !== id)));
    savePlan(); renderSubjects(); renderWeek();
  });
  $("#btnAddSubject").addEventListener("click", () => {
    plan.subjects.push({ id: uid(), name: "", priority: 3, color: COLORS[plan.subjects.length % COLORS.length] });
    savePlan(); renderSubjects();
    const inputs = $$('#subjectList input[type="text"]'); inputs[inputs.length - 1].focus();
  });

  function renderDayToggles() {
    $("#dayToggles").innerHTML = DAYS.map((d, i) => `<button type="button" data-d="${i}" aria-pressed="${!!plan.settings.days[i]}">${d}</button>`).join("");
  }
  $("#dayToggles").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const i = +b.dataset.d; plan.settings.days[i] = plan.settings.days[i] ? 0 : 1;
    b.setAttribute("aria-pressed", !!plan.settings.days[i]); savePlan();
  });
  const fields = { pStart: "start", pHours: "hours", pSession: "session", pBreak: "brk" };
  Object.entries(fields).forEach(([id, key]) => {
    const el = $("#" + id); el.value = plan.settings[key];
    el.addEventListener("change", () => { plan.settings[key] = el.type === "number" ? +el.value : el.value; savePlan(); });
  });

  function renderWeek() {
    const wk = $("#week");
    const has = Object.values(plan.schedule).some((a) => a.length);
    if (!has) {
      wk.innerHTML = '<p class="empty">No timetable yet. Add your subjects, pick your study days, then choose Generate timetable.</p>';
      wk.style.display = "block"; $("#summary").innerHTML = ""; progress(); return;
    }
    wk.style.display = "";
    wk.innerHTML = DAYS.map((name, i) => {
      const blocks = (plan.schedule[i] || []).slice().sort((a, b) => toMin(a.start) - toMin(b.start));
      const mins = blocks.reduce((t, b) => t + Math.max(0, toMin(b.end) - toMin(b.start)), 0);
      return `<div class="day ${blocks.length ? "" : "off"}" data-day="${i}">
        <h3>${name}<small>${blocks.length ? (mins / 60).toFixed(1).replace(/\.0$/, "") + " h" : "rest"}</small></h3>
        ${blocks.map((b) => {
          const s = subj(b.sid) || { name: "(removed)", color: "#888" };
          return `<button class="block ${b.done ? "done" : ""}" data-day="${i}" data-bid="${b.id}" style="--c:${s.color}">
            <b>${esc(s.name || "Untitled")}</b><span>${b.start}–${b.end}</span>
            <input type="checkbox" ${b.done ? "checked" : ""} aria-label="Mark ${esc(s.name)} ${b.start} as done"></button>`;
        }).join("")}
        <button class="add-block" data-day="${i}">+ Add</button></div>`;
    }).join("");

    const tally = {};
    Object.values(plan.schedule).flat().forEach((b) => { tally[b.sid] = (tally[b.sid] || 0) + Math.max(0, toMin(b.end) - toMin(b.start)); });
    $("#summary").innerHTML = plan.subjects.filter((s) => tally[s.id]).map((s) =>
      `<span><i style="background:${s.color}"></i>${esc(s.name || "Untitled")} ${(tally[s.id] / 60).toFixed(1).replace(/\.0$/, "")} h/week</span>`).join("");
    progress();
  }
  function progress() {
    const all = Object.values(plan.schedule).flat(), done = all.filter((b) => b.done).length;
    $("#progBar").style.width = all.length ? (100 * done) / all.length + "%" : "0";
    $("#progText").textContent = all.length ? `${done} of ${all.length} sessions done this week` : "";
  }

  // block editing
  const dlg = $("#blockDialog");
  let editing = null;
  function openDialog(day, bid) {
    editing = { day, bid };
    const b = bid ? plan.schedule[day].find((x) => x.id === bid) : null;
    $("#dlgTitle").textContent = (b ? "Edit block · " : "New block · ") + DAYS[day];
    $("#dlgSubject").innerHTML = plan.subjects.map((s) => `<option value="${s.id}">${esc(s.name || "Untitled")}</option>`).join("");
    $("#dlgSubject").value = b ? b.sid : plan.subjects[0]?.id;
    $("#dlgStart").value = b ? b.start : plan.settings.start;
    $("#dlgEnd").value = b ? b.end : (() => { const e = toMin(plan.settings.start) + plan.settings.session; return pad(Math.floor(e / 60) % 24) + ":" + pad(e % 60); })();
    $("#dlgDelete").hidden = !b;
    dlg.showModal();
  }
  $("#week").addEventListener("click", (e) => {
    if (e.target.matches('.block input[type="checkbox"]')) {
      const blk = e.target.closest(".block");
      plan.schedule[blk.dataset.day].find((x) => x.id === blk.dataset.bid).done = e.target.checked;
      savePlan(); renderWeek(); return;
    }
    const blk = e.target.closest(".block"); if (blk) return openDialog(+blk.dataset.day, blk.dataset.bid);
    const add = e.target.closest(".add-block"); if (add && plan.subjects.length) openDialog(+add.dataset.day, null);
  });
  $("#blockForm").addEventListener("submit", () => {
    const { day, bid } = editing;
    const list = (plan.schedule[day] = plan.schedule[day] || []);
    const data = { sid: $("#dlgSubject").value, start: $("#dlgStart").value, end: $("#dlgEnd").value };
    if (bid) Object.assign(list.find((x) => x.id === bid), data); else list.push({ id: uid(), done: false, ...data });
    savePlan(); renderWeek();
  });
  $("#dlgCancel").addEventListener("click", () => dlg.close());
  $("#dlgDelete").addEventListener("click", () => {
    plan.schedule[editing.day] = plan.schedule[editing.day].filter((x) => x.id !== editing.bid);
    savePlan(); renderWeek(); dlg.close();
  });

  $("#btnGenerate").addEventListener("click", async () => {
    const msg = $("#planMsg"); msg.className = "msg"; msg.textContent = "Building your week…";
    try {
      const r = await fetch("/api/timetable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subjects: plan.subjects, settings: plan.settings }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Something went wrong.");
      plan.schedule = {};
      Object.entries(data.schedule).forEach(([d, blocks]) => (plan.schedule[d] = blocks.map((b) => ({ id: uid(), done: false, ...b }))));
      savePlan(); renderWeek();
      msg.textContent = `Done: ${data.slots_per_day} sessions per study day.`;
    } catch (err) { msg.className = "msg err"; msg.textContent = err.message; }
  });
  $("#btnClearPlan").addEventListener("click", () => { if (confirm("Clear the whole timetable?")) { plan.schedule = {}; savePlan(); renderWeek(); } });
  $("#btnPrint").addEventListener("click", () => { showTab("t-plan"); print(); });

  renderSubjects(); renderDayToggles(); renderWeek();

  /* ------------------------------------------------------------- PDF notes */
  const drop = $("#drop"), input = $("#pdfInput");
  let doc = null, activeTerm = null, style = "underline";

  $("#btnPick").addEventListener("click", () => input.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", () => input.files[0] && upload(input.files[0]));
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) upload(f); });

  async function upload(file) {
    const msg = $("#notesMsg"); msg.className = "msg";
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { msg.className = "msg err"; msg.textContent = "Please choose a PDF file."; return; }
    msg.textContent = "Reading and analysing your PDF…";
    const fd = new FormData(); fd.append("pdf", file);
    try {
      const r = await fetch("/api/analyze", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Couldn't analyse that file.");
      doc = data; activeTerm = null; msg.textContent = "";
      $("#nbName").textContent = data.filename;
      $("#nbStats").textContent = `${data.stats.pages} pages · ${data.stats.words.toLocaleString()} words · about ${data.stats.minutes} min to read`;
      $("#notesOut").hidden = false;
      renderChips(); renderReader();
    } catch (err) { msg.className = "msg err"; msg.textContent = err.message; }
    input.value = "";
  }

  const strength = () => +$("#strength").value / 100;
  const termRe = (t) => new RegExp("\\b" + t.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+") + "s?\\b", "gi");

  function renderChips() {
    $("#chips").innerHTML = doc.topics.map((t, i) => `<button class="chip ${activeTerm === t.term ? "on" : ""}" data-t="${esc(t.term)}">${esc(t.term)}<small>${t.count}</small></button>`).join("") + (doc.topics.length ? "" : "");
  }
  $("#chips").addEventListener("click", (e) => {
    const c = e.target.closest(".chip"); if (!c) return;
    activeTerm = activeTerm === c.dataset.t ? null : c.dataset.t;
    renderChips(); renderReader();
    if (activeTerm) $("#reader mark.term")?.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
  });

  function renderReader() {
    const thr = strength();
    const boldRe = new RegExp("\\b(" + doc.topics.map((t) => t.term.split(" ").join("\\s+").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")s?\\b", "gi");
    const hit = activeTerm ? termRe(activeTerm) : null;
    const points = [];
    let html = "", open = false;
    const markup = (t, important) => {
      let s = esc(t);
      if (important) s = s.replace(boldRe, "<b>$&</b>");
      if (hit) s = s.replace(hit, (m) => `<mark class="term">${m}</mark>`);
      return s;
    };
    for (const pg of doc.pages) {
      html += `<div class="pg">Page ${pg.n}</div>`;
      for (const it of pg.items) {
        if (it.k === "h") { if (open) { html += "</p>"; open = false; } html += `<h4>${markup(it.t, false)}</h4>`; continue; }
        if (it.p || !open) { if (open) html += "</p>"; html += "<p>"; open = true; }
        const imp = it.r <= thr;
        if (imp) points.push({ t: it.t, n: pg.n });
        html += (imp ? `<span class="imp">${markup(it.t, true)}</span>` : markup(it.t, false)) + " ";
      }
      if (open) { html += "</p>"; open = false; }
    }
    $("#reader").innerHTML = html;
    $("#points").innerHTML = points.slice(0, 60).map((p) => `<li>${esc(p.t)}<em>p.${p.n}</em></li>`).join("") +
      (points.length > 60 ? `<li class="hint">…and ${points.length - 60} more in the text.</li>` : "");
    $("#points").dataset.plain = points.map((p) => `- ${p.t} (p.${p.n})`).join("\n");
  }
  $("#strength").addEventListener("input", (e) => { $("#strVal").textContent = e.target.value + "%"; if (doc) renderReader(); });
  $$(".seg button").forEach((b) => b.addEventListener("click", () => {
    style = b.dataset.style;
    $$(".seg button").forEach((x) => x.classList.toggle("on", x === b));
    $("#reader").className = "reader mode-" + style;
  }));
  $("#btnCopy").addEventListener("click", async (e) => {
    try { await navigator.clipboard.writeText($("#points").dataset.plain || ""); e.target.textContent = "Copied"; setTimeout(() => (e.target.textContent = "Copy"), 1500); } catch { /* clipboard blocked */ }
  });
})();
