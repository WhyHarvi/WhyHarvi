// Shared bits for the profile-art generators (stats.mjs, snake.mjs):
// GitHub GraphQL fetch, palette, and the terminal-window chrome every card uses.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const LOGIN = process.env.GH_LOGIN || "WhyHarvi";
export const MONO = `'JetBrains Mono','SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace`;
export const C = {
  bg: "#07090d", bar: "#0d1117", line: "#1c2430", dim: "#5b6675", text: "#c9d1d9",
  green: "#3dffa2", cyan: "#3dd9ff", amber: "#ffc94d", pink: "#ff3d7f", violet: "#9d7bff",
  levels: ["#11161d", "#0b3d2a", "#11704a", "#1fb371", "#3dffa2"],
};

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const fmt = (n) => n.toLocaleString("en-US");

export async function gql(query, variables = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "profile-art" },
    body: JSON.stringify({ query, variables: { login: LOGIN, ...variables } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  return json.data;
}

export const text = (x, y, s, { size = 13, fill = C.text, anchor = "start", weight = 400, extra = "" } = {}) =>
  `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" ${extra}>${s}</text>`;

export const prompt = (cmd, y = 78) =>
  `<text x="32" y="${y}" font-family="${MONO}" font-size="15" xml:space="preserve" filter="url(#glow)"><tspan fill="${C.green}">harvi@whyharvi</tspan><tspan fill="${C.dim}">:</tspan><tspan fill="${C.cyan}">~</tspan><tspan fill="${C.dim}">$ </tspan><tspan fill="${C.text}">${esc(cmd)}</tspan></text>`;

/** Wraps `body` in the shared terminal window: title bar, glow filter, scanlines, sweep, vignette. */
export function terminal({ W, H, title, label, body, defs = "" }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">
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
    ${defs}
  </defs>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="12" fill="${C.bg}" stroke="${C.line}" stroke-width="2"/>
  <path d="M1 13a12 12 0 0 1 12-12h${W - 26}a12 12 0 0 1 12 12v33H1z" fill="${C.bar}"/>
  <line x1="1" y1="46" x2="${W - 1}" y2="46" stroke="${C.line}" stroke-width="2"/>
  <circle cx="26" cy="24" r="6.5" fill="#ff5f57"/><circle cx="48" cy="24" r="6.5" fill="#febc2e"/><circle cx="70" cy="24" r="6.5" fill="#28c840"/>
  ${text(W / 2, 29, esc(title), { fill: C.dim, anchor: "middle" })}
  <g clip-path="url(#screen)">
    ${body}
    <rect x="0" y="0" width="${W}" height="${H}" fill="url(#scan)" pointer-events="none"/>
    <rect x="0" y="-120" width="${W}" height="120" fill="url(#sweep)" pointer-events="none"><animate attributeName="y" values="-120;${H}" dur="7s" repeatCount="indefinite"/></rect>
    <rect x="0" y="0" width="${W}" height="${H}" fill="url(#vig)" pointer-events="none"/>
  </g>
</svg>
`;
}

export function write(out, svg) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, svg);
}
