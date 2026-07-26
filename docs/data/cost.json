/* The East Stand Movement — reads the JSON the collector commits. No build step. */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function grab(path, fallback) {
  try {
    const r = await fetch(`./data/${path}?t=${Date.now()}`);
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch {
    return fallback;
  }
}

/* ---------- ticker ---------- */

function renderTicker(cost, fixtures, wire) {
  if (cost && cost.cost_usd != null) {
    $("tickCost").textContent = `Running cost: $${cost.cost_usd.toFixed(2)} since ${cost.since || "day one"}`;
    $("tickCalls").textContent = `${cost.calls} runs · ${cost.searches} searches`;
    $("footCost").textContent =
      `This site has cost $${cost.cost_usd.toFixed(2)} to run across ${cost.calls} collection runs.`;
  }
  if (fixtures && fixtures.length) {
    const f = fixtures[0];
    const d = new Date(f.utcDate);
    $("tickNext").textContent =
      `Next: ${f.home} v ${f.away} · ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
  }
  if (wire && wire.collected) {
    const d = new Date(wire.collected);
    $("tickUpdated").textContent =
      `Updated: ${d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
  }
}

/* ---------- mood ---------- */

function renderMood(mood) {
  if (!mood || !mood.length) return;
  const latest = mood[mood.length - 1];
  const el = $("moodNum");
  el.textContent = (latest.mood > 0 ? "+" : "") + latest.mood.toFixed(0);
  el.dataset.sign = latest.mood > 8 ? "pos" : latest.mood < -8 ? "neg" : "flat";

  const week = mood.slice(-7);
  const avg = week.reduce((a, m) => a + m.mood, 0) / week.length;
  $("moodSub").textContent =
    `7-day average ${avg > 0 ? "+" : ""}${avg.toFixed(0)} · scale −100 to +100`;

  const pts = mood.slice(-45);
  if (pts.length < 2) return;
  const w = 200, h = 44;
  const path = pts.map((p, i) => {
    const x = (i / (pts.length - 1)) * w;
    const y = h / 2 - (p.mood / 100) * (h / 2 - 3);
    return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  $("moodSpark").innerHTML =
    `<line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="rgba(231,228,220,0.3)" stroke-width="1"/>` +
    `<path d="${path}" fill="none" stroke="#F2C500" stroke-width="2"/>`;
}

/* ---------- match card ---------- */

const AXES = [
  ["control", "Control"], ["creation", "Creation"], ["prevention", "Prevention"],
  ["set_pieces", "Set pieces"], ["intensity", "Intensity"], ["game_management", "Game management"],
];

function renderMatch(cards) {
  const box = $("matchCard");
  if (!cards || !cards.length) {
    box.className = "";
    box.innerHTML = `<div class="fail">No match marked yet. The first card appears
      within a day of the next fixture finishing.</div>`;
    return;
  }
  const c = cards[cards.length - 1];
  const m = c.match || {};
  const mg = c.manager || {};
  const t = c.team || {};

  const axes = AXES.map(([k, label]) => {
    const v = Number(t[k] ?? 0);
    return `<div class="axis">
      <div class="axis-top"><span>${label}</span><span>${v.toFixed(1)}</span></div>
      <div class="axis-bar"><div class="axis-fill" data-low="${v < 5}" style="width:${Math.max(0, Math.min(10, v)) * 10}%"></div></div>
    </div>`;
  }).join("");

  const changeMin = mg.first_change_min == null ? "none" : `${mg.first_change_min}'`;
  const impact = Number(mg.sub_impact ?? 0);

  box.className = "";
  box.innerHTML = `
  <div class="mc">
    <div class="mc-top">
      <div class="mc-fixture">${esc(m.opponent)} <span style="color:var(--grey)">(${esc(m.venue)})</span></div>
      <div class="mc-meta">${esc(m.competition)} · ${esc(m.date)}
        ${c.verified === false ? '<span class="unverified">unverified</span>' : ""}</div>
    </div>
    <div class="mc-body">
      <div class="mc-half">
        <div class="mc-h">Team · ${Number(c.team_rating ?? 0).toFixed(1)} / 10</div>
        <div class="mc-score">${esc(m.score)}</div>
        ${axes}
        <p class="verdict">${esc(c.team_verdict)}</p>
      </div>
      <div class="mc-half">
        <div class="mc-h">Manager · ${Number(c.manager_rating ?? 0).toFixed(1)} / 10</div>
        <div class="stat-row"><span>First real change</span><b>${changeMin}</b></div>
        <div class="stat-row"><span>Substitution impact</span><b>${impact > 0 ? "+" : ""}${impact}</b></div>
        <div class="stat-row"><span>Selection</span><b>${Number(mg.selection ?? 0).toFixed(1)}</b></div>
        <div class="stat-row"><span>Reaction</span><b>${Number(mg.reaction ?? 0).toFixed(1)}</b></div>
        <div class="stat-row"><span>Plan B</span><b>${esc(mg.plan_b)}</b></div>
        <p class="verdict">${esc(c.manager_verdict)}</p>
        <div class="counter"><strong>A fair critic would say:</strong> ${esc(mg.counterfactual)}</div>
      </div>
    </div>
  </div>`;
}

/* ---------- rumours ---------- */

function renderRumours(book) {
  const box = $("rumourBoard");
  const list = Object.values(book || {});
  if (!list.length) {
    box.className = "";
    box.innerHTML = `<div class="fail">Nothing on the board yet. Rumours accumulate
      as the wire runs.</div>`;
    return;
  }
  list.sort((a, b) => (a.status === b.status ? b.temperature - a.temperature : a.status === "live" ? -1 : 1));
  box.className = "";
  box.innerHTML = list.slice(0, 14).map((r) => `
    <div class="rum" data-cold="${r.status !== "live"}">
      <div class="rum-name">${esc(r.subject)}</div>
      <div class="rum-track"><div class="rum-heat" style="width:${Math.min(100, r.temperature)}%"></div></div>
      <div class="rum-meta">
        <span class="tier">T${r.best_tier}</span>
        ${r.mentions} mention${r.mentions === 1 ? "" : "s"}
        ${r.status !== "live" ? `· dead after ${r.lifespan_days ?? 0}d` : ""}
      </div>
    </div>`).join("");
}

/* ---------- wire ---------- */

let ALL = [], FILTER = "all";
const CATS = ["all", "transfers", "team news", "match", "club", "opinion"];

function drawWire() {
  const box = $("wire");
  const items = FILTER === "all" ? ALL : ALL.filter((i) => (i.category || "") === FILTER);
  if (!items.length) {
    box.className = "";
    box.innerHTML = `<div class="fail">Nothing filed under ${esc(FILTER)} in this batch.</div>`;
    return;
  }
  box.className = "";
  box.innerHTML = items.map((i) => `
    <article class="story">
      <div class="story-meta">${esc(i.published || "—")}<br>${esc(i.category || "club")}
        ${i.is_rumour ? '<br><span class="tier">rumour T' + esc(i.source_tier) + "</span>" : ""}</div>
      <div>
        <h3>${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">${esc(i.headline)}</a>` : esc(i.headline)}</h3>
        <p>${esc(i.summary)}</p>
        <div class="story-src">${esc(i.source)}</div>
      </div>
    </article>`).join("");
}

function drawChips() {
  $("chips").innerHTML = CATS.map((c) =>
    `<button class="chip" data-on="${c === FILTER}" data-cat="${c}">${c}</button>`).join("");
  $("chips").querySelectorAll(".chip").forEach((b) =>
    b.addEventListener("click", () => { FILTER = b.dataset.cat; drawChips(); drawWire(); }));
}

/* ---------- boot ---------- */

(async function () {
  const [wire, mood, rumours, matches, cost, fixtures] = await Promise.all([
    grab("wire.json", { items: [] }),
    grab("mood.json", []),
    grab("rumours.json", {}),
    grab("matches.json", []),
    grab("cost.json", null),
    grab("fixtures.json", []),
  ]);

  ALL = wire.items || [];
  renderTicker(cost, fixtures, wire);
  renderMood(mood);
  renderMatch(matches);
  renderRumours(rumours);
  drawChips();
  drawWire();
})();
