// Builds dist/stats.svg: a terminal-style activity card that matches the
// header/projects/footer art. Runs in the `profile` workflow with GITHUB_TOKEN,
// so the README has no dependency on third-party stat-card servers.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const LOGIN = process.env.GH_LOGIN || "WhyHarvi";
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = process.argv[2] || "dist/stats.svg";
if (!TOKEN) throw new Error("GITHUB_TOKEN is required");

const query = `query($login:String!){
  user(login:$login){
    contributionsCollection{
      contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } }
    }
    repositories(first:100, ownerAffiliations:OWNER, isFork:false, privacy:PUBLIC){
      totalCount
      nodes{ languages(first:10, orderBy:{field:SIZE, direction:DESC}){ edges{ size node{ name } } } }
    }
  }
}`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "profile-stats" },
  body: JSON.stringify({ query, variables: { login: LOGIN } }),
});
const json = await res.json();
if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
const u = json.data.user;

// ---- numbers -------------------------------------------------------------
const cal = u.contributionsCollection.contributionCalendar;
const days = cal.weeks.flatMap((w) => w.contributionDays);

let longest = 0, run = 0;
for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
// Current streak: today may still be in progress, so a 0 today doesn't break it.
let current = 0;
for (let i = days.length - 1; i >= 0; i--) {
  if (days[i].contributionCount > 0) current++;
  else if (i === days.length - 1) continue;
  else break;
}

const weekly = cal.weeks.map((w) => w.contributionDays.reduce((s, d) => s + d.contributionCount, 0)).slice(-52);
const best = Math.max(...weekly, 1);

const IGNORE = new Set(["HTML", "CSS", "SCSS", "Dockerfile", "Shell", "Makefile", "PLpgSQL", "Procfile", "Batchfile"]);
const langBytes = {};
for (const r of u.repositories.nodes)
  for (const e of r.languages.edges)
    if (!IGNORE.has(e.node.name)) langBytes[e.node.name] = (langBytes[e.node.name] || 0) + e.size;
const langTotal = Object.values(langBytes).reduce((a, b) => a + b, 0) || 1;
const langs = Object.entries(langBytes).sort((a, b) => b[1] - a[1]).slice(0, 5)
  .map(([name, b]) => ({ name, pct: (b / langTotal) * 100 }));

// ---- svg -----------------------------------------------------------------
const W = 960, H = 404;
const MONO = `'JetBrains Mono','SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace`;
const C = { bg: "#07090d", bar: "#0d1117", line: "#1c2430", dim: "#5b6675", text: "#c9d1d9",
  green: "#3dffa2", cyan: "#3dd9ff", amber: "#ffc94d", pink: "#ff3d7f", violet: "#9d7bff" };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => n.toLocaleString("en-US");
const t = (x, y, s, { size = 13, fill = C.text, anchor = "start", weight = 400, extra = "" } = {}) =>
  `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" ${extra}>${s}</text>`;
const fadeIn = (delay) => `opacity="0"><animate attributeName="opacity" from="0" to="1" begin="${delay}s" dur=".5s" fill="freeze"/`;

const tiles = [
  { label: "CONTRIBUTIONS", sub: "last 12 months", value: fmt(cal.totalContributions), color: C.green },
  { label: "CURRENT STREAK", sub: current === 1 ? "day" : "days", value: fmt(current), color: C.cyan },
  { label: "LONGEST STREAK", sub: "days, last 12 months", value: fmt(longest), color: C.amber },
  { label: "PUBLIC REPOS", sub: "original work, no forks",value: fmt(u.repositories.totalCount), color: C.pink },
];
const tileW = 210, tileGap = 16, tileX0 = 32, tileY = 98;
const tileSvg = tiles.map((tl, i) => {
  const x = tileX0 + i * (tileW + tileGap);
  return `<g ${fadeIn(0.5 + i * 0.15)}>
    <rect x="${x}" y="${tileY}" width="${tileW}" height="96" rx="8" fill="${C.bar}" stroke="${C.line}"/>
    <rect x="${x}" y="${tileY + 18}" width="3" height="60" rx="1.5" fill="${tl.color}"/>
    ${t(x + 20, tileY + 28, tl.label, { size: 11, fill: C.dim, extra: 'letter-spacing="1.5"' })}
    ${t(x + 20, tileY + 66, tl.value, { size: 34, fill: tl.color, weight: 700, extra: 'filter="url(#glow)"' })}
    ${t(x + 20, tileY + 84, esc(tl.sub), { size: 11, fill: C.dim })}
  </g>`;
}).join("\n");

// weekly contribution bars (left panel)
const pX = 32, pY = 222, pW = 520, pH = 140;
const chartTop = pY + 40, chartH = pH - 56, barW = (pW - 32) / weekly.length;
const bars = weekly.map((v, i) => {
  const h = v === 0 ? 2 : Math.max(3, (v / best) * chartH);
  const x = pX + 16 + i * barW, yb = chartTop + chartH;
  const op = v === 0 ? 0.18 : 0.45 + 0.55 * (v / best);
  const delay = (0.9 + i * 0.018).toFixed(3);
  return `<rect x="${x.toFixed(1)}" y="${yb}" width="${(barW - 2.4).toFixed(1)}" height="0" rx="1.5" fill="${C.green}" fill-opacity="${op.toFixed(2)}">` +
    `<animate attributeName="height" from="0" to="${h.toFixed(1)}" begin="${delay}s" dur=".6s" fill="freeze"/>` +
    `<animate attributeName="y" from="${yb}" to="${(yb - h).toFixed(1)}" begin="${delay}s" dur=".6s" fill="freeze"/></rect>`;
}).join("");

// languages (right panel)
const lX = pX + pW + 16, lW = W - 32 - lX;
const langColors = [C.green, C.cyan, C.amber, C.violet, C.pink];
const langRows = langs.map((l, i) => {
  const y = pY + 52 + i * 19, trackX = lX + 132, trackW = lW - 132 - 64;
  const w = Math.max(2, (l.pct / 100) * trackW);
  const delay = (1.2 + i * 0.12).toFixed(2);
  return `${t(lX + 16, y + 4, esc(l.name), { size: 12, fill: C.text })}
    <rect x="${trackX}" y="${y - 5}" width="${trackW}" height="8" rx="4" fill="${C.line}"/>
    <rect x="${trackX}" y="${y - 5}" width="0" height="8" rx="4" fill="${langColors[i]}"><animate attributeName="width" from="0" to="${w.toFixed(1)}" begin="${delay}s" dur=".8s" fill="freeze"/></rect>
    ${t(lX + lW - 16, y + 4, `${l.pct.toFixed(1)}%`, { size: 12, fill: C.dim, anchor: "end" })}`;
}).join("\n");

const updated = new Date().toISOString().slice(0, 10);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="GitHub activity: ${fmt(cal.totalContributions)} contributions in the last year, current streak ${current} days, longest streak ${longest} days, ${u.repositories.totalCount} public repos">
  <defs>
    <filter id="glow" x="-20%" y="-50%" width="140%" height="200%">
      <feGaussianBlur stdDeviation="2.4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="2" fill="#000" opacity=".28"/></pattern>
    <radialGradient id="vig" cx="50%" cy="50%" r="75%">
      <stop offset="60%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".55"/>
    </radialGradient>
    <linearGradient id="sweep" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.green}" stop-opacity="0"/><stop offset=".5" stop-color="${C.green}" stop-opacity=".06"/><stop offset="1" stop-color="${C.green}" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="screen"><rect x="2" y="47" width="${W - 4}" height="${H - 49}"/></clipPath>
  </defs>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="12" fill="${C.bg}" stroke="${C.line}" stroke-width="2"/>
  <path d="M1 13a12 12 0 0 1 12-12h${W - 26}a12 12 0 0 1 12 12v33H1z" fill="${C.bar}"/>
  <line x1="1" y1="46" x2="${W - 1}" y2="46" stroke="${C.line}" stroke-width="2"/>
  <circle cx="26" cy="24" r="6.5" fill="#ff5f57"/><circle cx="48" cy="24" r="6.5" fill="#febc2e"/><circle cx="70" cy="24" r="6.5" fill="#28c840"/>
  ${t(W / 2, 29, "~/activity — gh stats", { fill: C.dim, anchor: "middle" })}
  <g clip-path="url(#screen)">
    <text x="32" y="78" font-family="${MONO}" font-size="15" xml:space="preserve" filter="url(#glow)"><tspan fill="${C.green}">harvi@whyharvi</tspan><tspan fill="${C.dim}">:</tspan><tspan fill="${C.cyan}">~</tspan><tspan fill="${C.dim}">$ </tspan><tspan fill="${C.text}">gh stats --last-year</tspan></text>
    ${tileSvg}
    <g ${fadeIn(0.8)}>
      <rect x="${pX}" y="${pY}" width="${pW}" height="${pH}" rx="8" fill="${C.bar}" stroke="${C.line}"/>
      ${t(pX + 16, pY + 24, "CONTRIBUTIONS / WEEK", { size: 11, fill: C.dim, extra: 'letter-spacing="1.5"' })}
      ${t(pX + pW - 16, pY + 24, `peak ${fmt(best)}`, { size: 11, fill: C.dim, anchor: "end" })}
    </g>
    ${bars}
    <g ${fadeIn(1.0)}>
      <rect x="${lX}" y="${pY}" width="${lW}" height="${pH}" rx="8" fill="${C.bar}" stroke="${C.line}"/>
      ${t(lX + 16, pY + 24, "TOP LANGUAGES", { size: 11, fill: C.dim, extra: 'letter-spacing="1.5"' })}
      ${t(lX + lW - 16, pY + 24, "public repos", { size: 11, fill: C.dim, anchor: "end" })}
      ${langRows}
    </g>
    ${t(32, H - 18, `// auto-generated ${updated} · refreshes every 12h`, { size: 11, fill: C.dim })}
    <rect x="0" y="0" width="${W}" height="${H}" fill="url(#scan)" pointer-events="none"/>
    <rect x="0" y="-120" width="${W}" height="120" fill="url(#sweep)" pointer-events="none"><animate attributeName="y" values="-120;${H}" dur="7s" repeatCount="indefinite"/></rect>
    <rect x="0" y="0" width="${W}" height="${H}" fill="url(#vig)" pointer-events="none"/>
  </g>
</svg>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg);
console.log(`wrote ${OUT}: ${cal.totalContributions} contribs, streak ${current}/${longest}, ${u.repositories.totalCount} repos, langs ${langs.map((l) => l.name).join(",")}`);
