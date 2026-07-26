/* The East Stand Movement — reads the JSON the collector commits. No build step. */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s === null || s === undefined ? "" : s)
  .replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (v, d = 0) => (isFinite(Number(v)) ? Number(v) : d);

const CALM = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

async function grab(file, fallback) {
  try {
    const r = await fetch("./data/" + file + "?t=" + Date.now());
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    return fallback;
  }
}

/* ---------------- mood gauge ---------------- */

function renderMood(mood) {
  if (!Array.isArray(mood) || !mood.length) return;
  const latest = mood[mood.length - 1];
  const v = num(latest.mood);

  const read = $("moodNum");
  read.textContent = (v > 0 ? "+" : "") + v.toFixed(0);
  read.parentElement.dataset.sign = v > 8 ? "pos" : v < -8 ? "neg" : "flat";

  // semicircle: -100 => -90deg, +100 => +90deg
  const angle = Math.max(-100, Math.min(100, v)) / 100 * 90;
  const needle = $("gaugeNeedle");
  const fill = $("gaugeFill");
  const arc = 283;
  const set = () => {
    needle.style.transform = "rotate(" + angle + "deg)";
    fill.style.strokeDashoffset = String(arc - ((angle + 90) / 180) * arc);
    fill.style.stroke = v < -8 ? "#FF6B5A" : "var(--yellow)";
  };
  CALM ? set() : setTimeout(set, 120);

  const window7 = mood.slice(-7);
  const avg = window7.reduce((a, m) => a + num(m.mood), 0) / window7.length;
  const dir = v > avg + 4 ? "warming" : v < avg - 4 ? "cooling" : "steady";
  $("moodTrend").textContent = dir + " · 7-day " + (avg > 0 ? "+" : "") + avg.toFixed(0);

  $("issueNo").textContent = "No. " + mood.length;
}

/* ---------------- matchday strip ---------------- */

function renderMatchday(fixtures) {
  if (!Array.isArray(fixtures) || !fixtures.length) return;
  const f = fixtures[0];
  const when = new Date(f.utcDate);
  if (isNaN(when)) return;

  const strip = $("matchday");
  strip.hidden = false;
  $("mdFixture").textContent = f.home + " v " + f.away;

  const tick = () => {
    const diff = when.getTime() - Date.now();
    if (diff <= 0) {
      strip.dataset.state = "soon";
      $("mdLabel").textContent = "Under way or just finished";
      $("mdClock").textContent = "card due within a day";
      return;
    }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    strip.dataset.state = diff < 48 * 3600000 ? "soon" : "normal";
    $("mdLabel").textContent = diff < 48 * 3600000
      ? (f.competition || "Next fixture") + " · imminent"
      : (f.competition || "Next fixture");
    $("mdClock").textContent = d > 0
      ? d + "d " + h + "h " + m + "m"
      : h + "h " + m + "m " + String(s).padStart(2, "0") + "s";
  };
  tick();
  setInterval(tick, 1000);
}

/* ---------------- match card ---------------- */

const AXES = [
  ["control", "Control"], ["creation", "Creation"], ["prevention", "Prevention"],
  ["set_pieces", "Set pieces"], ["intensity", "Intensity"], ["game_management", "Management"],
];

function renderMatch(cards) {
  if (!Array.isArray(cards) || !cards.length) return;
  const c = cards[cards.length - 1];
  const m = c.match || {};
  const t = c.team || {};
  const mg = c.manager || {};
  const change = mg.first_change_min === null || mg.first_change_min === undefined
    ? "none" : num(mg.first_change_min) + "'";
  const impact = num(mg.sub_impact);

  $("matchCard").className = "";
  $("matchCard").innerHTML =
    '<div class="card">' +
      '<div class="card-top">' +
        '<div class="card-fixture">' + esc(m.opponent) +
          ' <span style="color:var(--grey)">(' + esc(m.venue) + ')</span></div>' +
        '<div class="card-score" data-r="' + esc(m.result) + '">' + esc(m.score) + '</div>' +
        '<div class="card-meta">' + esc(m.competition) + ' · ' + esc(m.date) +
          (c.verified === false ? '<span class="tag-unver">unverified</span>' : "") + '</div>' +
      '</div>' +
      '<div class="card-body">' +
        '<div class="card-half">' +
          '<div class="card-h"><span>The team</span><b>' + num(c.team_rating).toFixed(1) + '</b></div>' +
          '<div class="radar-hold"><canvas id="radar"></canvas></div>' +
          '<p class="verdict">' + esc(c.team_verdict) + '</p>' +
        '</div>' +
        '<div class="card-half">' +
          '<div class="card-h"><span>The manager</span><b>' + num(c.manager_rating).toFixed(1) + '</b></div>' +
          '<div class="mstat"><span>First real change</span><b>' + change + '</b></div>' +
          '<div class="mstat"><span>Substitution impact</span><b data-good="' + (impact >= 0) + '">' +
            (impact > 0 ? "+" : "") + impact + '</b></div>' +
          '<div class="mstat"><span>Selection</span><b>' + num(mg.selection).toFixed(1) + '</b></div>' +
          '<div class="mstat"><span>Reaction</span><b>' + num(mg.reaction).toFixed(1) + '</b></div>' +
          '<div class="mstat"><span>Plan B</span><b>' + esc(mg.plan_b) + '</b></div>' +
          '<p class="verdict">' + esc(c.manager_verdict) + '</p>' +
          '<div class="counter"><strong>A fair critic would say</strong>' + esc(mg.counterfactual) + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  if (!window.Chart) return;
  new Chart($("radar"), {
    type: "radar",
    data: {
      labels: AXES.map((a) => a[1]),
      datasets: [{
        data: AXES.map((a) => num(t[a[0]])),
        backgroundColor: "rgba(245,196,0,0.32)",
        borderColor: "#101010",
        borderWidth: 2,
        pointBackgroundColor: "#C8102E",
        pointRadius: 3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: CALM ? false : { duration: 700 },
      plugins: { legend: { display: false } },
      scales: {
        r: {
          min: 0, max: 10, ticks: { display: false, stepSize: 2 },
          grid: { color: "rgba(16,16,16,0.16)" },
          angleLines: { color: "rgba(16,16,16,0.16)" },
          pointLabels: { font: { family: "'IBM Plex Mono', monospace", size: 10 }, color: "#6C665E" },
        },
      },
    },
  });
}

/* ---------------- rumours ---------------- */

function rumRow(r) {
  const heat = Math.max(0, Math.min(100, num(r.temperature)));
  return '<div class="rum">' +
    '<div class="rum-name">' + esc(r.subject) + '</div>' +
    '<div class="rum-track"><div class="rum-heat" data-hot="' + (heat > 55) + '" style="width:' + heat + '%"></div></div>' +
    '<div class="rum-meta"><span class="tier">T' + esc(r.best_tier) + '</span>' +
      num(r.mentions) + (num(r.mentions) === 1 ? " mention" : " mentions") +
      (r.status !== "live" ? " · died after " + num(r.lifespan_days) + "d" : "") +
    '</div></div>';
}

function renderRumours(book) {
  const all = book && typeof book === "object" ? Object.values(book) : [];
  const live = all.filter((r) => r.status === "live").sort((a, b) => num(b.temperature) - num(a.temperature));
  const dead = all.filter((r) => r.status !== "live").sort((a, b) => num(b.lifespan_days) - num(a.lifespan_days));

  if (live.length) {
    $("rumourLive").className = "";
    $("rumourLive").innerHTML = live.slice(0, 12).map(rumRow).join("");
  }
  if (dead.length) {
    $("graveWrap").hidden = false;
    $("graveCount").textContent = "(" + dead.length + ")";
    $("rumourDead").innerHTML = dead.slice(0, 20).map(rumRow).join("");
  }
}

/* ---------------- wire ---------------- */

let ALL = [];
let FILTER = "all";
const CATS = ["all", "transfers", "team news", "match", "club", "opinion"];

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
        (i.is_rumour ? '<span class="story-rum">rumour T' + esc(i.source_tier) + '</span>' : "") +
      '</div>' +
      '<div><h3>' +
        (i.url ? '<a href="' + esc(i.url) + '" target="_blank" rel="noopener noreferrer">' + esc(i.headline) + '</a>' : esc(i.headline)) +
      '</h3><p>' + esc(i.summary) + '</p>' +
      '<div class="story-src">' + esc(i.source) + '</div></div>' +
    '</article>').join("");
}

function drawChips() {
  $("chips").innerHTML = CATS.map((c) =>
    '<button class="chip" data-on="' + (c === FILTER) + '" data-cat="' + c + '">' + c + '</button>').join("");
  Array.prototype.forEach.call($("chips").querySelectorAll(".chip"), (b) => {
    b.addEventListener("click", () => { FILTER = b.dataset.cat; drawChips(); drawWire(); });
  });
}

/* ---------------- numbers ---------------- */

const GRID = "rgba(232,228,219,0.14)";
const TICK = { color: "#9C958B", font: { family: "'IBM Plex Mono', monospace", size: 10 } };

function renderCharts(mood, cards) {
  if (!window.Chart) return;

  if (Array.isArray(mood) && mood.length > 1) {
    new Chart($("moodChart"), {
      type: "line",
      data: {
        labels: mood.map((m) => m.date.slice(5)),
        datasets: [{
          data: mood.map((m) => num(m.mood)),
          borderColor: "#F5C400", borderWidth: 2,
          backgroundColor: "rgba(245,196,0,0.12)", fill: true,
          pointRadius: 0, tension: 0.28,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: CALM ? false : { duration: 600 },
        plugins: { legend: { display: false } },
        scales: {
          y: { min: -100, max: 100, grid: { color: GRID }, ticks: TICK },
          x: { grid: { display: false }, ticks: Object.assign({ maxTicksLimit: 7 }, TICK) },
        },
      },
    });
    $("moodChartNote").textContent = mood.length + " days recorded. Above zero is favourable coverage.";
  } else {
    $("moodChartNote").textContent = "One reading so far. The line becomes useful after a fortnight.";
  }

  const pts = (Array.isArray(cards) ? cards : [])
    .filter((c) => c.manager && c.manager.first_change_min != null)
    .map((c) => ({
      x: num(c.manager.first_change_min),
      y: num(c.manager.sub_impact),
      label: (c.match && c.match.opponent) || "",
    }));

  if (pts.length) {
    new Chart($("reactChart"), {
      type: "scatter",
      data: { datasets: [{ data: pts, backgroundColor: "#C8102E", pointRadius: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: CALM ? false : { duration: 600 },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => c.raw.label + ": " + c.raw.x + "', impact " + c.raw.y } },
        },
        scales: {
          x: { min: 0, max: 90, title: { display: true, text: "minute of first change", color: "#9C958B", font: { family: "'IBM Plex Mono', monospace", size: 10 } }, grid: { color: GRID }, ticks: TICK },
          y: { min: -2.5, max: 2.5, title: { display: true, text: "impact", color: "#9C958B", font: { family: "'IBM Plex Mono', monospace", size: 10 } }, grid: { color: GRID }, ticks: TICK },
        },
      },
    });
    $("reactChartNote").textContent = pts.length + " matches. Bottom right is the worst quadrant: late changes that achieved nothing.";
  } else {
    $("reactChartNote").textContent = "Fills in once matches have been marked. Bottom right will be the worst quadrant: late changes that achieved nothing.";
  }
}

function renderTally(cost, mood, cards, book) {
  const rum = book && typeof book === "object" ? Object.values(book) : [];
  const cells = [
    [mood && mood.length ? mood.length : 0, "days recorded"],
    [rum.length, "rumours tracked"],
    [Array.isArray(cards) ? cards.length : 0, "matches marked"],
    [cost ? cost.searches : 0, "searches run"],
    ["$" + (cost ? num(cost.cost_usd).toFixed(2) : "0.00"), "spent so far"],
  ];
  $("tally").innerHTML = cells.map((c) =>
    '<div class="tally-cell"><b>' + esc(c[0]) + '</b><span>' + c[1] + '</span></div>').join("");
}

/* ---------------- boot ---------------- */

(async function () {
  const [wire, mood, rumours, matches, cost, fixtures] = await Promise.all([
    grab("wire.json", { items: [] }),
    grab("mood.json", []),
    grab("rumours.json", {}),
    grab("matches.json", []),
    grab("cost.json", null),
    grab("fixtures.json", []),
  ]);

  ALL = (wire && wire.items) || [];

  if (cost) {
    const line = "$" + num(cost.cost_usd).toFixed(2) + " · " + num(cost.calls) + " runs";
    $("navCost").textContent = line;
    $("footCost").textContent = "This site has cost $" + num(cost.cost_usd).toFixed(2) +
      " to run across " + num(cost.calls) + " collection runs and " + num(cost.searches) + " web searches.";
  }

  renderMood(mood);
  renderMatchday(fixtures);
  renderMatch(matches);
  renderRumours(rumours);
  drawChips();
  drawWire();
  renderCharts(mood, matches);
  renderTally(cost, mood, matches, rumours);
})();
