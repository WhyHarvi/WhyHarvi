// Builds the ~/activity stats card (dist/stats.svg) from the GitHub API.
import { C, esc, fmt, gql, prompt, terminal, text as t, write } from "./lib.mjs";

const OUT = process.argv[2] || "dist/stats.svg";

const { user: u } = await gql(`query($login:String!){
  user(login:$login){
    contributionsCollection{
      contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } }
    }
    repositories(first:100, ownerAffiliations:OWNER, isFork:false, privacy:PUBLIC){
      totalCount
      nodes{ languages(first:10, orderBy:{field:SIZE, direction:DESC}){ edges{ size node{ name } } } }
    }
  }
}`);

// ---- numbers -------------------------------------------------------------
const cal = u.contributionsCollection.contributionCalendar;
const days = cal.weeks.flatMap((w) => w.contributionDays);
const last90 = days.slice(-90).reduce((s, d) => s + d.contributionCount, 0);
const bestDay = days.reduce((a, d) => (d.contributionCount > a.contributionCount ? d : a), days[0]);
const bestDate = new Date(`${bestDay.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

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
const fadeIn = (delay) => `opacity="0"><animate attributeName="opacity" from="0" to="1" begin="${delay}s" dur=".5s" fill="freeze"/`;

const tiles = [
  { label: "CONTRIBUTIONS", sub: "last 12 months", value: fmt(cal.totalContributions), color: C.green },
  { label: "LAST 90 DAYS", sub: "and accelerating", value: fmt(last90), color: C.cyan },
  { label: "BEST DAY", sub: bestDate, value: fmt(bestDay.contributionCount), color: C.amber },
  { label: "PUBLIC REPOS", sub: "original work, no forks", value: fmt(u.repositories.totalCount), color: C.pink },
];
// "and accelerating" only when the last 90 days really are above the yearly pace.
if (last90 / 90 <= cal.totalContributions / days.length) tiles[1].sub = "contributions";

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
  return `${t(lX + 16, y + 4, esc(l.name), { size: 12 })}
    <rect x="${trackX}" y="${y - 5}" width="${trackW}" height="8" rx="4" fill="${C.line}"/>
    <rect x="${trackX}" y="${y - 5}" width="0" height="8" rx="4" fill="${langColors[i]}"><animate attributeName="width" from="0" to="${w.toFixed(1)}" begin="${delay}s" dur=".8s" fill="freeze"/></rect>
    ${t(lX + lW - 16, y + 4, `${l.pct.toFixed(1)}%`, { size: 12, fill: C.dim, anchor: "end" })}`;
}).join("\n");

const updated = new Date().toISOString().slice(0, 10);
write(OUT, terminal({
  W, H,
  title: "~/activity — gh stats",
  label: `GitHub activity: ${fmt(cal.totalContributions)} contributions in the last year, ${fmt(last90)} in the last 90 days, best day ${bestDay.contributionCount}, ${u.repositories.totalCount} public repos`,
  body: `${prompt("gh stats --last-year")}
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
    ${t(32, H - 18, `// auto-generated ${updated} · refreshes every 12h`, { size: 11, fill: C.dim })}`,
}));
console.log(`wrote ${OUT}: ${cal.totalContributions} total, ${last90} last 90d, best day ${bestDay.contributionCount}, langs ${langs.map((l) => l.name).join(",")}`);
