// Builds dist/snake.svg: a real game of Snake played on the contribution graph.
// Each loop holds RUNS different games. In each one the snake hunts contribution
// cells, grows one segment per cell eaten, then dies mid-board by biting its own
// body. The graph heals and the next game starts somewhere else. The RNG is
// seeded with the date, so every rebuild plays different games.
//
// Animation is pure SMIL (works inside <img> on GitHub): the head follows one
// route path via animateMotion; body segment i replays the same motion i steps
// behind (negative begin offset), and is only visible once the snake is long
// enough to have it.
import { C, esc, gql, prompt, terminal, text as t, write } from "./lib.mjs";

const OUT = process.argv[2] || "dist/snake.svg";
const SEED = process.env.SNAKE_SEED || new Date().toISOString().slice(0, 10);
const RUNS = 4;          // different games per loop
const DT = 0.085;        // seconds per step
const PARK = 6;          // steps the snake sits at spawn before moving
const DEATH = 2.6;       // seconds for death + heal between games
const START_LEN = 3;
const MAX_LEN = 46;
const PITCH = 16, CELL = 13;

// ---- data ----------------------------------------------------------------
const { user } = await gql(`query($login:String!){ user(login:$login){ contributionsCollection{ contributionCalendar{
  weeks{ contributionDays{ date weekday contributionLevel } } } } } }`);
const weeks = user.contributionsCollection.contributionCalendar.weeks;
const COLS = weeks.length, ROWS = 7;
const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

const K = (x, y) => x * 8 + y, KX = (k) => Math.floor(k / 8), KY = (k) => k % 8;
const level = new Map(); // cell key -> 0..4 (missing = no cell, e.g. days after today)
weeks.forEach((w, x) => w.contributionDays.forEach((d) => level.set(K(x, d.weekday), LEVEL[d.contributionLevel] ?? 0)));
const food = new Set([...level].filter(([, l]) => l > 0).map(([k]) => k));
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const neighbors = (k) => {
  const x = KX(k), y = KY(k), out = [];
  for (const [dx, dy] of DIRS) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && level.has(K(nx, ny))) out.push(K(nx, ny));
  }
  return out;
};

// ---- seeded rng ----------------------------------------------------------
function rngFrom(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
const rng = rngFrom(`${SEED}:${food.size}`);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Shortest path (random tie-breaks) from `from` to the nearest cell matching isTarget, avoiding `blocked`. Returns the steps after `from`. */
function bfs(from, blocked, isTarget) {
  const prev = new Map([[from, -1]]), q = [from];
  for (let qi = 0; qi < q.length; qi++) {
    const cur = q[qi];
    for (const n of shuffle(neighbors(cur))) {
      if (prev.has(n)) continue;
      if (isTarget(n)) {
        const path = [n];
        for (let p = cur; p !== from; p = prev.get(p)) path.push(p);
        return path.reverse();
      }
      if (blocked.has(n)) continue;
      prev.set(n, cur);
      q.push(n);
    }
  }
  return null;
}

/** Free cells reachable from `from` (flood fill), counted up to `cap`. */
function space(from, blocked, cap) {
  const seen = new Set([from]), q = [from];
  for (let i = 0; i < q.length && seen.size < cap; i++)
    for (const n of neighbors(q[i])) if (!seen.has(n) && !blocked.has(n)) { seen.add(n); q.push(n); }
  return seen.size;
}

// ---- play the games ------------------------------------------------------
function play(start) {
  const hist = Array(START_LEN).fill(start); // every head position so far; body = last `len`
  const lenAt = [];                          // length after each move
  const eatenAt = [];                        // [cell, move number]
  const eaten = new Set();
  let len = START_LEN, bites = 0, doomed = false, cause = "ran out of road";
  // Die somewhere in the middle of the meal: 30–55% of the graph.
  const deathBites = Math.max(12, Math.min(MAX_LEN - START_LEN, Math.round(food.size * (0.3 + rng() * 0.25))));

  for (let moves = 0; moves < 900; moves++) {
    const body = hist.slice(-len);          // tail ... head
    const head = body.at(-1);
    if (len >= 8 && (bites >= deathBites || moves > 420)) doomed = true;
    let path = null;
    if (!doomed) {
      const blocked = new Set(body.slice(1));
      path = bfs(head, blocked, (n) => food.has(n) && !eaten.has(n));
      // Look-ahead: never step into a pocket smaller than the body (it would trap itself early).
      // If the food route is unsafe or walled off, take the roomiest free neighbour instead.
      const need = len + 2;
      if (!path || space(path[0], blocked, need) < need) {
        const free = neighbors(head).filter((n) => !blocked.has(n))
          .map((n) => [n, space(n, blocked, need) + rng() * 0.5]).sort((a, b) => b[1] - a[1]);
        if (free.length) path = [free[0][0]];
        else if (len >= 8) doomed = true;
      }
    }
    if (doomed) {
      // Turn and bite the body: any segment except the tail (it moves away) and the neck.
      const biteable = new Set(body.slice(1, -4));
      path = bfs(head, new Set(body), (n) => biteable.has(n));
    }
    if (!path) { cause = "got boxed in"; break; }
    const next = path[0];
    hist.push(next);
    if (body.slice(1).includes(next)) { cause = "bit its own tail"; lenAt.push(len); break; }
    if (food.has(next) && !eaten.has(next)) {
      eaten.add(next); bites++; eatenAt.push([next, moves + 1]);
      len = Math.min(MAX_LEN, len + 1);
    }
    lenAt.push(len);
  }
  return { start, moves: hist.slice(START_LEN), lenAt, eatenAt, len, bites, cause, corpse: hist.slice(-len) };
}

const walkable = [...level.keys()];
const empties = walkable.filter((k) => !food.has(k));
const games = [];
for (let r = 0; r < RUNS; r++) {
  // Spawn on an empty cell, away from earlier spawns so every game takes a different route.
  const base = empties.length ? empties : walkable;
  const apart = base.filter((k) => games.every((g) => Math.abs(KX(g.start) - KX(k)) > 6));
  const choices = apart.length ? apart : base;
  games.push(play(choices[Math.floor(rng() * choices.length)]));
}

// ---- timeline ------------------------------------------------------------
let clock = 0;
for (const g of games) {
  g.S = clock;
  g.moveStart = g.S + PARK * DT;
  g.E = g.moveStart + g.moves.length * DT;
  clock = g.E + DEATH;
}
const T = clock;
const DUR = `dur="${T.toFixed(3)}s" repeatCount="indefinite"`;
const kt = (s) => Math.min(1, Math.max(0, s / T)).toFixed(6);

/** Stepwise animation over the whole loop. events: [[seconds, value], ...] */
function discrete(attr, base, events) {
  const times = ["0.000000"], vals = [base];
  for (const [s, v] of [...events].sort((a, b) => a[0] - b[0])) {
    const f = kt(s);
    if (f <= times.at(-1)) { vals[vals.length - 1] = v; continue; }
    times.push(f); vals.push(v);
  }
  return `<animate attributeName="${attr}" ${DUR} calcMode="discrete" keyTimes="${times.join(";")}" values="${vals.join(";")}"/>`;
}

// ---- geometry --------------------------------------------------------------
const W = 960, X0 = W - 32 - COLS * PITCH, Y0 = 116, H = Y0 + ROWS * PITCH + 62;
const cx = (k) => X0 + KX(k) * PITCH + CELL / 2, cy = (k) => Y0 + KY(k) * PITCH + CELL / 2;

// One route for the whole loop: game 1 moves, jump, game 2 moves, ..., jump back to game 1's spawn.
const pts = [];
for (const g of games) { g.startIdx = pts.length; pts.push(g.start, ...g.moves); g.endIdx = pts.length - 1; }
pts.push(games[0].start);
const cum = [0];
for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(cx(pts[i]) - cx(pts[i - 1]), cy(pts[i]) - cy(pts[i - 1])));
const total = cum.at(-1) || 1;
const route = pts.map((k, i) => `${i ? "L" : "M"}${cx(k)} ${cy(k)}`).join("");

const kT = ["0.000000"], kP = ["0.000000"];
const key = (s, idx) => { const f = kt(s); if (f > kT.at(-1)) { kT.push(f); kP.push((cum[idx] / total).toFixed(6)); } };
games.forEach((g, r) => {
  key(g.moveStart, g.startIdx);                                             // parked at spawn
  key(g.E, g.endIdx);                                                       // one cell per step
  key(g.E + 0.001, r + 1 < RUNS ? games[r + 1].startIdx : pts.length - 1);  // jump to next spawn
});
if (kT.at(-1) !== "1.000000") { kT.push("1.000000"); kP.push("1.000000"); }
const motion = (i) =>
  `<animateMotion ${DUR} begin="${i === 0 ? "0" : (i * DT - T).toFixed(3)}s" calcMode="linear" keyTimes="${kT.join(";")}" keyPoints="${kP.join(";")}"><mpath href="#route" xlink:href="#route"/></animateMotion>`;

// ---- svg parts -------------------------------------------------------------
// Grid cells: eaten -> empty, healed in a left-to-right wave after each death.
const cellEvents = new Map();
for (const g of games) {
  for (const [k, move] of g.eatenAt) {
    const ev = cellEvents.get(k) || [];
    ev.push([g.moveStart + move * DT, C.levels[0]], [g.E + 1.1 + 0.9 * (KX(k) / COLS), C.levels[level.get(k)]]);
    cellEvents.set(k, ev);
  }
}
const cells = [...level].map(([k, l]) => {
  const ev = cellEvents.get(k);
  const attrs = `x="${X0 + KX(k) * PITCH}" y="${Y0 + KY(k) * PITCH}" width="${CELL}" height="${CELL}" rx="3" fill="${C.levels[l]}"`;
  return ev ? `<rect ${attrs}>${discrete("fill", C.levels[l], ev)}</rect>` : `<rect ${attrs}/>`;
}).join("");

// Snake: segment 0 is the head; drawn tail-first so the head sits on top. Body tapers toward the tail.
const segments = [];
for (let i = MAX_LEN - 1; i >= 0; i--) {
  const ev = [];
  for (const g of games) {
    let from = null;
    if (i < START_LEN) from = g.S;
    else { const m = g.lenAt.findIndex((l) => l > i); if (m >= 0) from = g.moveStart + (m + 1) * DT; }
    if (from !== null) ev.push([from, 1], [g.E, 0]);
  }
  if (!ev.length) continue;
  const size = i === 0 ? PITCH - 1 : PITCH - 1 - 5 * (i / MAX_LEN); // segments nearly touch -> one continuous body
  const fill = i === 0 ? "#eafff4" : C.green;
  const op = i === 0 ? 1 : (1 - 0.55 * (i / MAX_LEN)).toFixed(2);
  segments.push(`<rect x="${(-size / 2).toFixed(2)}" y="${(-size / 2).toFixed(2)}" width="${size.toFixed(2)}" height="${size.toFixed(2)}" rx="${(size / 3.6).toFixed(2)}" fill="${fill}" fill-opacity="${op}" opacity="0"${i === 0 ? ' filter="url(#glow)"' : ""}>${discrete("opacity", 0, ev)}${motion(i)}</rect>`);
}

// Death: the body freezes as a pink corpse, blinks, then crumbles tail-first; a ring bursts at the head.
const deaths = games.map((g) => {
  const blink = [[g.E, 1], [g.E + 0.14, 0.25], [g.E + 0.28, 1], [g.E + 0.42, 0.25], [g.E + 0.56, 1], [g.E + DEATH - 0.4, 0]];
  const n = g.corpse.length, s = CELL - 1;
  const corpse = g.corpse.map((k, j) =>
    `<rect x="${(cx(k) - s / 2).toFixed(1)}" y="${(cy(k) - s / 2).toFixed(1)}" width="${s}" height="${s}" rx="3.5" fill="${C.pink}">${discrete("opacity", 1, [[g.E + 0.9 + 0.9 * (j / n), 0]])}</rect>`).join("");
  const hk = g.moves.at(-1) ?? g.start;
  const burst = `<circle cx="${cx(hk)}" cy="${cy(hk)}" r="0" fill="none" stroke="${C.pink}" stroke-width="2" opacity="0">` +
    `<animate attributeName="r" ${DUR} keyTimes="0;${kt(g.E)};${kt(g.E + 0.7)};1" values="0;0;30;30"/>` +
    `<animate attributeName="opacity" ${DUR} keyTimes="0;${kt(g.E - 0.001)};${kt(g.E)};${kt(g.E + 0.7)};1" values="0;0;.9;0;0"/></circle>`;
  return `<g opacity="0" filter="url(#glow)">${discrete("opacity", 0, blink)}${corpse}</g>${burst}`;
}).join("");

// Status line: what's happening in each game.
const statusY = H - 26;
const status = games.map((g, r) => {
  const next = r + 1 < RUNS ? games[r + 1].S : T;
  const live = `<g opacity="0">${discrete("opacity", 0, [[g.S, 1], [g.E, 0]])}${t(X0, statusY, `<tspan fill="${C.green}">▸ game ${r + 1}/${RUNS}</tspan> · hunting commits · grows with every day of work it eats`, { size: 12, fill: C.dim })}</g>`;
  const dead = `<g opacity="0">${discrete("opacity", 0, [[g.E, 1], [next, 0]])}${t(X0, statusY, `<tspan fill="${C.pink}">✕ game over</tspan> · ${esc(g.cause)} at length ${g.len} · ate ${g.bites} days of work`, { size: 12, fill: C.dim })}</g>`;
  return live + dead;
}).join("");
const lx = W - 32 - 5 * 15 - 30;
const legend = t(lx - 6, statusY, "less", { size: 11, fill: C.dim, anchor: "end" }) +
  C.levels.map((c, i) => `<rect x="${lx + i * 15}" y="${statusY - 10}" width="11" height="11" rx="2.5" fill="${c}"/>`).join("") +
  t(lx + 5 * 15 + 2, statusY, "more", { size: 11, fill: C.dim });

// Month + weekday labels.
const monthOf = (w) => new Date(`${w.contributionDays[0].date}T12:00:00Z`).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
const months = [];
weeks.forEach((w, x) => { if (!x || monthOf(w) !== monthOf(weeks[x - 1])) months.push({ x, m: monthOf(w) }); });
if (months.length > 1 && months[1].x - months[0].x < 3) months.shift();
const monthLabels = months.map(({ x, m }) => t(X0 + x * PITCH, Y0 - 10, m, { size: 11, fill: C.dim })).join("");
const dayLabels = [[1, "Mon"], [3, "Wed"], [5, "Fri"]].map(([y, s]) => t(X0 - 10, Y0 + y * PITCH + 10, s, { size: 10, fill: C.dim, anchor: "end" })).join("");

write(OUT, terminal({
  W, H,
  title: "~/activity — snake",
  label: `Snake game on my contribution graph: ${RUNS} different games per loop; the snake grows as it eats my work, then bites itself mid-board`,
  defs: `<path id="route" d="${route}" fill="none"/>`,
  body: `${prompt(`./snake --feed contributions --seed ${SEED}`)}
    ${monthLabels}${dayLabels}
    ${cells}
    ${deaths}
    ${segments.join("")}
    ${status}${legend}`,
}));
console.log(`wrote ${OUT}: loop ${T.toFixed(1)}s, ${games.map((g, i) => `game ${i + 1}: ${g.moves.length} moves, len ${g.len}, ate ${g.bites}, ${g.cause}`).join(" | ")}`);
