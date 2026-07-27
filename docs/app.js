/* The East Stand Movement — reads the JSON the collector commits. No build step.
   Everything a reader does is kept in this browser only. */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s === null || s === undefined ? "" : s)
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (v, d = 0) => (isFinite(Number(v)) ? Number(v) : d);
const CALM = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const AXES = [
  ["control", "Control"], ["creation", "Creation"], ["prevention", "Prevention"],
  ["set_pieces", "Set pieces"], ["intensity", "Intensity"], ["game_management", "Management"],
];
const CATS = ["all", "transfers", "team news", "match", "club", "opinion"];

/* ---------------- storage ---------------- */

const KEY_MARKS = "esm.marks.v1";
const KEY_VOTES = "esm.votes.v1";
const KEY_PREDS = "esm.preds.v1";

function store(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function put(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
}

let MARKS = store(KEY_MARKS, {});
let VOTES = store(KEY_VOTES, {});
let PREDS = store(KEY_PREDS, {});

let ALL = [], CARDS = [], MOOD = [], BOOK = {}, INDEX = [], FIXTURES = [];
let FILTER = "all";

async function grab(file, fallback) {
  try {
    const r = await fetch("./data/" + file + "?t=" + Date.now());
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) { return fallback; }
}

/* ---------------- coverage gauge ---------------- */

function renderMood() {
  if (!MOOD.length) return;
  const v = num(MOOD[MOOD.length - 1].mood);
  const read = $("moodNum");
  read.textContent = (v > 0 ? "+" : "") + v.toFixed(0);
  read.parentElement.dataset.sign = v > 8 ? "pos" : v < -8 ? "neg" : "flat";

  const angle = Math.max(-100, Math.min(100, v)) / 100 * 90;
  const apply = () => {
    $("gaugeNeedle").style.transform = "rotate(" + angle + "deg)";
    $("gaugeFill").style.strokeDashoffset = String(283 - ((angle + 90) / 180) * 283);
    $("gaugeFill").style.stroke = v < -8 ? "var(--red)" : "var(--gold)";
  };
  CALM ? apply() : setTimeout(apply, 120);

  const last7 = MOOD.slice(-7);
  const avg = last7.reduce((a, m) => a + num(m.mood), 0) / last7.length;
  $("moodTrend").textContent =
    (v > avg + 4 ? "warming" : v < avg - 4 ? "cooling" : "steady") +
    " · 7-day " + (avg > 0 ? "+" : "") + avg.toFixed(0);
  $("issueNo").textContent = "No. " + MOOD.length;
}

/* ---------------- matchday + calendar ---------------- */

function icsDate(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function downloadCalendar() {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//East Stand Movement//EN"];
  FIXTURES.forEach((f, i) => {
    const start = new Date(f.utcDate);
    if (isNaN(start.getTime())) return;
    const end = new Date(start.getTime() + 2 * 3600000);
    lines.push("BEGIN:VEVENT",
      "UID:esm-" + i + "-" + start.getTime() + "@eaststand",
      "DTSTAMP:" + icsDate(new Date().toISOString()),
      "DTSTART:" + icsDate(f.utcDate),
      "DTEND:" + icsDate(end.toISOString()),
      "SUMMARY:" + f.home + " v " + f.away,
      "DESCRIPTION:" + (f.competition || "Fixture"),
      "END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "united-fixtures.ics";
  a.click();
  URL.revokeObjectURL(a.href);
}

function renderMatchday() {
  if (!FIXTURES.length) return;
  const f = FIXTURES[0];
  const when = new Date(f.utcDate);
  if (isNaN(when.getTime())) return;

  $("matchday").hidden = false;
  $("mdFixture").textContent = f.home + " v " + f.away;
  $("calBtn").hidden = false;
  $("calBtn").addEventListener("click", downloadCalendar);

  const tick = () => {
    const diff = when.getTime() - Date.now();
    if (diff <= 0) {
      $("matchday").dataset.state = "soon";
      $("mdLabel").textContent = "Under way or just finished";
      $("mdClock").textContent = "card due within a day";
      return;
    }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const soon = diff < 48 * 3600000;
    $("matchday").dataset.state = soon ? "soon" : "normal";
    $("mdLabel").textContent = (f.competition || "Next fixture") + (soon ? " · imminent" : "");
    $("mdClock").textContent = d > 0 ? d + "d " + h + "h " + m + "m"
      : h + "h " + m + "m " + String(s).padStart(2, "0") + "s";
  };
  tick();
  setInterval(tick, 1000);
}

/* ---------------- predict the score ---------------- */

function goalsFrom(text) {
  const m = String(text).match(/(\d+)\D+(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function outcome(h, a) { return h > a ? "H" : h < a ? "A" : "D"; }

function settlePredictions() {
  let played = 0, exact = 0, right = 0;
  Object.keys(PREDS).forEach((date) => {
    const p = PREDS[date];
    const card = CARDS.filter((c) => (c.match || {}).date === date)[0];
    if (!card) return;
    const actual = goalsFrom((card.match || {}).score);
    if (!actual) return;
    played += 1;
    if (p.h === actual[0] && p.a === actual[1]) exact += 1;
    if (outcome(p.h, p.a) === outcome(actual[0], actual[1])) right += 1;
  });
  return { made: Object.keys(PREDS).length, played: played, exact: exact, right: right };
}

function renderPredict() {
  if (!FIXTURES.length) return;
  const f = FIXTURES[0];
  const date = String(f.utcDate).slice(0, 10);
  const existing = PREDS[date];
  const box = $("predictPanel");
  box.className = "";

  if (existing) {
    const s = settlePredictions();
    box.innerHTML = '<div class="predict">' +
      '<div class="predict-label">Your prediction is in</div>' +
      '<div class="predict-team">' + esc(f.home) + ' <b>' + existing.h + '</b> — <b>' + existing.a + '</b> ' + esc(f.away) + '</div>' +
      '<div class="predict-done">Record so far: <b>' + s.played + '</b> settled · <b>' + s.exact +
        '</b> exact · <b>' + s.right + '</b> right result</div>' +
    '</div>';
    return;
  }

  box.innerHTML = '<div class="predict">' +
    '<div class="predict-label">Predict the score</div>' +
    '<div class="predict-team">' + esc(f.home) + '</div>' +
    '<input class="predict-in" id="pHome" type="number" min="0" max="15" value="0" aria-label="' + esc(f.home) + ' goals">' +
    '<input class="predict-in" id="pAway" type="number" min="0" max="15" value="0" aria-label="' + esc(f.away) + ' goals">' +
    '<div class="predict-team">' + esc(f.away) + '</div>' +
    '<button class="predict-go" id="pGo">Lock it in</button>' +
  '</div>';

  $("pGo").addEventListener("click", () => {
    PREDS[date] = { h: num($("pHome").value), a: num($("pAway").value), fixture: f.home + " v " + f.away };
    put(KEY_PREDS, PREDS);
    renderPredict();
    renderTally();
  });
}

/* ---------------- mark it yourself ---------------- */

function matchId(card) {
  const m = card.match || {};
  return (m.date || "") + "|" + (m.opponent || "");
}

function renderMarkPanel(card) {
  if (MARKS[matchId(card)]) { revealCard(card); return; }
  const m = card.match || {};
  const rows = AXES.map((a) =>
    '<div class="slider-row">' +
      '<label for="s_' + a[0] + '">' + a[1] + ' <b id="v_' + a[0] + '">5</b></label>' +
      '<input type="range" id="s_' + a[0] + '" min="0" max="10" step="0.5" value="5">' +
    '</div>').join("");

  $("markPanel").className = "";
  $("markPanel").innerHTML =
    '<div class="mark"><div class="mark-top">' +
      '<div class="mark-fixture">' + esc(m.opponent) + ' (' + esc(m.venue) + ') · ' + esc(m.score) + '</div>' +
      '<div class="mark-sub">Your marks first. 5 is competent, not a compliment.</div>' +
    '</div><div class="sliders">' + rows + '</div>' +
    '<button class="mark-go" id="markGo">Submit and see the card</button></div>';

  AXES.forEach((a) => {
    const input = $("s_" + a[0]);
    input.addEventListener("input", () => { $("v_" + a[0]).textContent = input.value; });
  });
  $("markGo").addEventListener("click", () => {
    const mine = {};
    AXES.forEach((a) => { mine[a[0]] = num($("s_" + a[0]).value, 5); });
    MARKS[matchId(card)] = { marks: mine, when: new Date().toISOString() };
    put(KEY_MARKS, MARKS);
    revealCard(card);
    renderTally();
  });
}

function comparison(card) {
  const mine = (MARKS[matchId(card)] || {}).marks;
  if (!mine) return "";
  const theirs = card.team || {};
  let diff = 0;
  AXES.forEach((a) => { diff += num(mine[a[0]], 5) - num(theirs[a[0]]); });
  const avg = diff / AXES.length;
  const word = Math.abs(avg) < 0.35 ? "almost exactly in line with" : avg > 0 ? "kinder than" : "harsher than";
  const mineAvg = AXES.reduce((s, a) => s + num(mine[a[0]], 5), 0) / AXES.length;
  return '<div class="mark-done">You gave it <b>' + mineAvg.toFixed(1) + '</b> — ' + word +
    ' the card, by <b>' + Math.abs(avg).toFixed(1) + '</b> on average.</div>';
}

function revealCard(card) {
  const m = card.match || {}, t = card.team || {}, mg = card.manager || {};
  const mine = (MARKS[matchId(card)] || {}).marks;
  const impact = num(mg.sub_impact);
  const change = mg.first_change_min === null || mg.first_change_min === undefined
    ? "none" : num(mg.first_change_min) + "'";

  $("markPanel").className = "";
  $("markPanel").innerHTML = comparison(card);
  $("matchCard").hidden = false;
  $("matchCard").innerHTML =
    '<div class="card"><div class="card-top">' +
      '<div class="card-fixture">' + esc(m.opponent) + ' <span style="color:var(--grey)">(' + esc(m.venue) + ')</span></div>' +
      '<div class="card-score" data-r="' + esc(m.result) + '">' + esc(m.score) + '</div>' +
      '<div class="card-meta">' + esc(m.competition) + ' · ' + esc(m.date) +
        (card.verified === false ? '<span class="tag-unver">unverified</span>' : "") + '</div>' +
    '</div><div class="card-body">' +
      '<div class="card-half">' +
        '<div class="card-h"><span>The team</span><b>' + num(card.team_rating).toFixed(1) + '</b></div>' +
        '<div class="radar-hold"><canvas id="radar"></canvas></div>' +
        '<p class="verdict">' + esc(card.team_verdict) + '</p>' +
      '</div><div class="card-half">' +
        '<div class="card-h"><span>The manager</span><b>' + num(card.manager_rating).toFixed(1) + '</b></div>' +
        '<div class="mstat"><span>First real change</span><b>' + change + '</b></div>' +
        '<div class="mstat"><span>Substitution impact</span><b data-good="' + (impact >= 0) + '">' + (impact > 0 ? "+" : "") + impact + '</b></div>' +
        '<div class="mstat"><span>Selection</span><b>' + num(mg.selection).toFixed(1) + '</b></div>' +
        '<div class="mstat"><span>Reaction</span><b>' + num(mg.reaction).toFixed(1) + '</b></div>' +
        '<div class="mstat"><span>Plan B</span><b>' + esc(mg.plan_b) + '</b></div>' +
        '<p class="verdict">' + esc(card.manager_verdict) + '</p>' +
        '<div class="counter"><strong>A fair critic would say</strong>' + esc(mg.counterfactual) + '</div>' +
      '</div></div>' +
      '<button class="share" id="shareBtn">Save this card as an image</button>' +
    '</div>';

  $("shareBtn").addEventListener("click", () => shareCard(card));

  if (!window.Chart) return;
  const sets = [{
    label: "The card", data: AXES.map((a) => num(t[a[0]])),
    backgroundColor: "rgba(218,41,28,0.26)", borderColor: "#DA291C", borderWidth: 2,
    pointBackgroundColor: "#DA291C", pointRadius: 3,
  }];
  if (mine) {
    sets.push({
      label: "Yours", data: AXES.map((a) => num(mine[a[0]], 5)),
      backgroundColor: "rgba(13,13,13,0.06)", borderColor: "#0D0D0D", borderWidth: 2,
      borderDash: [5, 4], pointBackgroundColor: "#0D0D0D", pointRadius: 3,
    });
  }
  new Chart($("radar"), {
    type: "radar",
    data: { labels: AXES.map((a) => a[1]), datasets: sets },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: CALM ? false : { duration: 700 },
      plugins: { legend: { display: !!mine, labels: { font: { family: "'IBM Plex Mono', monospace", size: 10 }, color: "#6B655D", boxWidth: 12 } } },
      scales: { r: { min: 0, max: 10, ticks: { display: false, stepSize: 2 },
        grid: { color: "rgba(13,13,13,0.15)" }, angleLines: { color: "rgba(13,13,13,0.15)" },
        pointLabels: { font: { family: "'IBM Plex Mono', monospace", size: 10 }, color: "#6B655D" } } },
    },
  });
}

/* ---------------- share as an image ---------------- */

function shareCard(card) {
  const c = $("shareCanvas");
  const g = c.getContext("2d");
  const m = card.match || {}, t = card.team || {}, mg = card.manager || {};

  g.fillStyle = "#0D0D0D"; g.fillRect(0, 0, 1080, 1080);
  g.fillStyle = "#DA291C"; g.fillRect(0, 0, 1080, 18);

  g.fillStyle = "#F2EFE9"; g.font = "700 44px Anton, Impact, sans-serif";
  g.fillText("THE EAST STAND MOVEMENT", 64, 110);

  g.fillStyle = "#9E978C"; g.font = "22px 'IBM Plex Mono', monospace";
  g.fillText(String(m.competition || "").toUpperCase() + "  ·  " + String(m.date || ""), 64, 158);

  g.fillStyle = "#F2EFE9"; g.font = "700 96px Anton, Impact, sans-serif";
  g.fillText(String(m.opponent || "").toUpperCase() + " (" + String(m.venue || "") + ")", 64, 288);

  g.fillStyle = m.result === "W" ? "#1E7A4B" : m.result === "L" ? "#DA291C" : "#F2EFE9";
  g.font = "700 150px Anton, Impact, sans-serif";
  g.fillText(String(m.score || ""), 64, 440);

  g.fillStyle = "#DA291C"; g.fillRect(64, 486, 952, 5);

  const rows = [
    ["TEAM", num(card.team_rating).toFixed(1)],
    ["MANAGER", num(card.manager_rating).toFixed(1)],
    ["FIRST CHANGE", (mg.first_change_min === null || mg.first_change_min === undefined) ? "NONE" : num(mg.first_change_min) + "'"],
    ["SUB IMPACT", (num(mg.sub_impact) > 0 ? "+" : "") + num(mg.sub_impact)],
  ];
  rows.forEach((row, i) => {
    const y = 570 + i * 88;
    g.fillStyle = "#9E978C"; g.font = "24px 'IBM Plex Mono', monospace";
    g.fillText(row[0], 64, y);
    g.fillStyle = "#FBE122"; g.font = "700 68px Anton, Impact, sans-serif";
    g.fillText(String(row[1]), 660, y + 12);
  });

  g.fillStyle = "#9E978C"; g.font = "20px 'IBM Plex Mono', monospace";
  const words = String(card.team_verdict || "").split(" ");
  let line = "", y = 946;
  words.forEach((w) => {
    if ((line + w).length > 62) { g.fillText(line, 64, y); line = ""; y += 30; }
    line += w + " ";
  });
  g.fillText(line, 64, y);

  g.fillStyle = "#6B655D"; g.font = "18px 'IBM Plex Mono', monospace";
  g.fillText("Marks generated from published reporting. Opinion, not analytics.", 64, 1040);

  c.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "united-" + String(m.opponent || "card").toLowerCase().replace(/\W+/g, "-") + ".png";
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

/* ---------------- rumours ---------------- */

function rumRow(key, r) {
  const heat = Math.max(0, Math.min(100, num(r.temperature)));
  const vote = VOTES[key];
  const dead = r.status !== "live";
  let right = "";
  if (dead && vote) {
    const correct = vote === "doubt";
    right = '<div class="called" data-right="' + correct + '">' + (correct ? "you called it" : "you believed it") + '</div>';
  }
  const buttons = dead ? right :
    '<div class="rum-vote">' +
      '<button class="vote" data-k="' + esc(key) + '" data-v="believe" data-picked="' + (vote === "believe") + '">believe</button>' +
      '<button class="vote" data-k="' + esc(key) + '" data-v="doubt" data-picked="' + (vote === "doubt") + '">doubt</button>' +
    '</div>';
  return '<div class="rum">' +
    '<div class="rum-name">' + esc(r.subject) + '</div>' +
    '<div class="rum-track"><div class="rum-heat" data-hot="' + (heat > 55) + '" style="width:' + heat + '%"></div></div>' +
    '<div class="rum-meta"><span class="tier">T' + esc(r.best_tier) + '</span>' + num(r.mentions) +
      (num(r.mentions) === 1 ? " mention" : " mentions") +
      (dead ? " · died after " + num(r.lifespan_days) + "d" : "") + '</div>' + buttons + '</div>';
}

function renderRumours() {
  const entries = Object.keys(BOOK).map((k) => [k, BOOK[k]]);
  const live = entries.filter((e) => e[1].status === "live").sort((a, b) => num(b[1].temperature) - num(a[1].temperature));
  const dead = entries.filter((e) => e[1].status !== "live").sort((a, b) => num(b[1].lifespan_days) - num(a[1].lifespan_days));

  if (live.length) {
    $("rumourLive").className = "";
    $("rumourLive").innerHTML = live.slice(0, 12).map((e) => rumRow(e[0], e[1])).join("");
  }
  if (dead.length) {
    $("graveWrap").hidden = false;
    $("graveCount").textContent = "(" + dead.length + ")";
    $("rumourDead").innerHTML = dead.slice(0, 20).map((e) => rumRow(e[0], e[1])).join("");
  }
  Array.prototype.forEach.call(document.querySelectorAll(".vote"), (b) => {
    b.addEventListener("click", () => {
      const k = b.dataset.k;
      if (VOTES[k] === b.dataset.v) { delete VOTES[k]; } else { VOTES[k] = b.dataset.v; }
      put(KEY_VOTES, VOTES);
      renderRumours();
      renderTally();
    });
  });
}

/* ---------------- wire ---------------- */

function drawWire() {
  const box = $("wireList");
  const items = FILTER === "all" ? ALL : ALL.filter((i) => (i.category || "") === FILTER);
  if (!items.length) {
    box.className = "empty";
    box.textContent = "Nothing filed under " + FILTER + " in this batch.";
    return;
  }
  box.className = "";
  box.innerHTML = items.map((i) =>
    '<article class="story">' +
      '<div class="story-meta">' + esc(i.published || "—") +
        '<span class="story-cat">' + esc(i.category || "club") + '</span>' +
        (i.is_rumour ? '<span class="story-rum">rumour T' + esc(i.source_tier) + '</span>' : "") + '</div>' +
      '<div><h3>' + (i.url ? '<a href="' + esc(i.url) + '" target="_blank" rel="noopener noreferrer">' + esc(i.headline) + '</a>' : esc(i.headline)) +
      '</h3><p>' + esc(i.summary) + '</p><div class="story-src">' + esc(i.source) + '</div></div>' +
    '</article>').join("");
}

function drawChips() {
  $("chips").innerHTML = CATS.map((c) =>
    '<button class="chip" data-on="' + (c === FILTER) + '" data-cat="' + c + '">' + c + '</button>').join("");
  Array.prototype.forEach.call($("chips").querySelectorAll(".chip"), (b) => {
    b.addEventListener("click", () => { FILTER = b.dataset.cat; drawChips(); drawWire(); });
  });
}

/* ---------------- archive search ---------------- */

function runSearch(term) {
  const box = $("searchResults");
  const q = String(term || "").trim().toLowerCase();

  if (!INDEX.length) {
    box.className = "empty";
    box.textContent = "The archive fills as the wire runs.";
    $("searchCount").textContent = "";
    return;
  }
  if (q.length < 2) {
    box.className = "";
    box.innerHTML = INDEX.slice(-12).reverse().map(hitRow).join("");
    $("searchCount").textContent = INDEX.length + " stories held";
    return;
  }

  const hits = INDEX.filter((r) =>
    (r.h + " " + r.s + " " + (r.p || []).join(" ")).toLowerCase().indexOf(q) !== -1
  ).reverse();

  $("searchCount").textContent = hits.length + " of " + INDEX.length;
  if (!hits.length) {
    box.className = "empty";
    box.textContent = "Nothing in the archive matches that yet.";
    return;
  }
  box.className = "";
  box.innerHTML = hits.slice(0, 40).map(hitRow).join("");
}

function hitRow(r) {
  return '<div class="hit"><div class="hit-date">' + esc(r.d) + '</div>' +
    '<h4>' + (r.u ? '<a href="' + esc(r.u) + '" target="_blank" rel="noopener noreferrer">' + esc(r.h) + '</a>' : esc(r.h)) + '</h4>' +
    '<div class="hit-src">' + esc(r.s) + ' · ' + esc(r.c) + '</div></div>';
}

function renderPeople(people) {
  const board = (people && people.board) || [];
  if (!board.length) return;
  const top = num(board[0].count, 1);
  $("peopleNote").textContent = "Last " + num(people.window_days, 30) + " days · click to search";
  $("peopleBoard").className = "";
  $("peopleBoard").innerHTML = board.map((p, i) =>
    '<div class="person" data-name="' + esc(p.name) + '">' +
      '<span class="person-rank">' + (i + 1) + '</span>' +
      '<span class="person-name">' + esc(p.name) + '</span>' +
      '<span class="person-bar" style="width:' + Math.max(4, (num(p.count) / top) * 70) + 'px"></span>' +
      '<span class="person-count">' + num(p.count) + '</span>' +
    '</div>').join("");

  Array.prototype.forEach.call(document.querySelectorAll(".person"), (el) => {
    el.addEventListener("click", () => {
      $("searchBox").value = el.dataset.name;
      runSearch(el.dataset.name);
      $("searchBox").scrollIntoView({ block: "center" });
    });
  });
}

/* ---------------- your record ---------------- */

function renderTally() {
  const marked = Object.keys(MARKS).length;
  const called = Object.keys(VOTES).length;
  let settled = 0, correct = 0;
  Object.keys(VOTES).forEach((k) => {
    const r = BOOK[k];
    if (r && r.status !== "live") { settled += 1; if (VOTES[k] === "doubt") correct += 1; }
  });
  const pct = settled ? Math.round((correct / settled) * 100) + "%" : "—";
  const p = settlePredictions();

  const cells = [
    [marked, "matches you marked", "red"],
    [called, "rumours you called", "red"],
    [pct, "of settled calls right", "gold"],
    [p.exact + "/" + p.played, "exact scores", "gold"],
    [INDEX.length, "stories archived", "red"],
  ];
  $("tally").innerHTML = cells.map((c) =>
    '<div class="tally-cell"><b data-accent="' + c[2] + '">' + esc(c[0]) + '</b><span>' + c[1] + '</span></div>').join("");
}

function renderCharts() {
  if (!window.Chart) return;
  const GRID = "rgba(242,239,233,0.13)";
  const TICK = { color: "#9E978C", font: { family: "'IBM Plex Mono', monospace", size: 10 } };

  if (MOOD.length > 1) {
    new Chart($("moodChart"), {
      type: "line",
      data: {
        labels: MOOD.map((m) => String(m.date).slice(5)),
        datasets: [{ data: MOOD.map((m) => num(m.mood)), borderColor: "#DA291C", borderWidth: 2,
          backgroundColor: "rgba(218,41,28,0.14)", fill: true, pointRadius: 0, tension: 0.28 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: CALM ? false : { duration: 600 },
        plugins: { legend: { display: false } },
        scales: { y: { min: -100, max: 100, grid: { color: GRID }, ticks: TICK },
          x: { grid: { display: false }, ticks: Object.assign({ maxTicksLimit: 7 }, TICK) } },
      },
    });
    $("moodChartNote").textContent = MOOD.length + " days recorded. Above zero is favourable coverage.";
  } else {
    $("moodChartNote").textContent = "One reading so far. The line becomes useful after a fortnight.";
  }

  const pts = CARDS.filter((c) => c.manager && c.manager.first_change_min !== null && c.manager.first_change_min !== undefined)
    .map((c) => ({ x: num(c.manager.first_change_min), y: num(c.manager.sub_impact), label: (c.match || {}).opponent || "" }));
  if (!pts.length) return;

  new Chart($("reactChart"), {
    type: "scatter",
    data: { datasets: [{ data: pts, backgroundColor: "#FBE122", pointRadius: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: CALM ? false : { duration: 600 },
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: (c) => c.raw.label + ": " + c.raw.x + "', impact " + c.raw.y } } },
      scales: {
        x: { min: 0, max: 90, grid: { color: GRID }, ticks: TICK, title: { display: true, text: "minute of first change", color: "#9E978C", font: { family: "'IBM Plex Mono', monospace", size: 10 } } },
        y: { min: -2.5, max: 2.5, grid: { color: GRID }, ticks: TICK, title: { display: true, text: "impact", color: "#9E978C", font: { family: "'IBM Plex Mono', monospace", size: 10 } } },
      },
    },
  });
  $("reactChartNote").textContent = pts.length + " matches. Bottom right is the worst quadrant: late changes that achieved nothing.";
}

/* ---------------- boot ---------------- */

(async function () {
  const r = await Promise.all([
    grab("wire.json", { items: [] }),
    grab("mood.json", []),
    grab("rumours.json", {}),
    grab("matches.json", []),
    grab("fixtures.json", []),
    grab("search-index.json", []),
    grab("people.json", { board: [] }),
  ]);

  ALL = (r[0] && r[0].items) || [];
  MOOD = Array.isArray(r[1]) ? r[1] : [];
  BOOK = r[2] && typeof r[2] === "object" ? r[2] : {};
  CARDS = Array.isArray(r[3]) ? r[3] : [];
  FIXTURES = Array.isArray(r[4]) ? r[4] : [];
  INDEX = Array.isArray(r[5]) ? r[5] : [];

  renderMood();
  renderMatchday();
  renderPredict();
  if (CARDS.length) renderMarkPanel(CARDS[CARDS.length - 1]);
  renderRumours();
  drawChips();
  drawWire();
  renderPeople(r[6]);
  runSearch("");
  renderTally();
  renderCharts();

  $("searchBox").addEventListener("input", (e) => runSearch(e.target.value));
  $("resetBtn").addEventListener("click", () => {
    if (!window.confirm("Clear your marks, calls and predictions from this device?")) return;
    MARKS = {}; VOTES = {}; PREDS = {};
    put(KEY_MARKS, MARKS); put(KEY_VOTES, VOTES); put(KEY_PREDS, PREDS);
    window.location.reload();
  });
})();
