// render.js — Supporter wall PNG renderer (runs once, in GitHub Actions)
// Fetches supporter/booster names from the Cloudflare Worker and renders
// supporters.png + boosters.png into ./site for GitHub Pages deployment.
// Rendering logic is identical to the old Railway server.js.

const { createCanvas, GlobalFonts } = require("@napi-rs/canvas");
const fs = require("fs");
const path = require("path");

const WORKER_URL = process.env.WORKER_URL || "https://supporter-wall.justper247.workers.dev/supporters";
const OUT_DIR = process.env.OUT_DIR || "site";

// ── Load system fonts ───────────────────────────────────────────────────────

function loadFontsFromDir(dir, depth = 0) {
  if (depth > 4) return 0;
  let count = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) count += loadFontsFromDir(full, depth + 1);
      else if (/\.(ttf|otf|ttc)$/i.test(entry.name)) {
        try { GlobalFonts.registerFromPath(full); count++; } catch {}
      }
    }
  } catch {}
  return count;
}

let totalFonts = 0;
for (const d of ["/usr/share/fonts", "/usr/local/share/fonts"]) totalFonts += loadFontsFromDir(d);
console.log("[Poster] Loaded " + totalFonts + " fonts");

const families = GlobalFonts.families.map(f => f.family);
const prio = [
  "Noto Sans", "Noto Sans CJK", "Noto Sans Symbols", "Noto Sans Symbols2",
  "Noto Sans Math", "Noto Sans Tibetan", "Noto Sans Syriac", "Noto Sans Runic",
  "Noto Sans Yi", "Noto Sans Bamum", "Noto Sans Arabic", "Noto Sans Hebrew",
  "Noto Sans Thai", "Noto Sans Georgian", "Noto Sans Armenian",
  "Noto Sans Devanagari", "Noto Color Emoji", "Symbola", "Tibetan Machine Uni",
];
const matched = [], used = new Set();
for (const p of prio) for (const f of families) if (!used.has(f) && f.toLowerCase().includes(p.toLowerCase())) { matched.push(f); used.add(f); }
for (const f of families) if (!used.has(f) && matched.length < 30) { matched.push(f); used.add(f); }
const FONTS = matched.map(f => '"' + f + '"').join(", ") + ", sans-serif";
console.log("[Poster] " + matched.length + " font families");

// ── Image config ────────────────────────────────────────────────────────────

const S_WIDTH  = parseInt(process.env.S_WIDTH)  || 2048;
const S_HEIGHT = parseInt(process.env.S_HEIGHT) || 2048;
const S_COLS   = parseInt(process.env.S_COLUMNS) || 8;
const S_COLOR  = process.env.S_COLOR || "#FF6B6B";

const B_WIDTH  = parseInt(process.env.B_WIDTH)  || 2048;
const B_HEIGHT = parseInt(process.env.B_HEIGHT) || 2048;
const B_COLOR  = process.env.B_COLOR || "#FF69F0";

// ── Parse ───────────────────────────────────────────────────────────────────

function parse(text) {
  const lines = text.split("\n");
  let sec = "", inN = false;
  const r = { s: [], b: [] };
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (l.startsWith("[SECTION:")) { const e = l.indexOf("]"); if (e > 9) sec = l.substring(9, e); inN = false; }
    else if (l === "[NAMES]") inN = true;
    else if (inN && l.trim()) (sec === "supporters" ? r.s : r.b).push(l.trim());
  }
  return r;
}

// ── Emoji detection ──────────────────────────────────────────────────────────
// Color emojis render ~2x taller than text, causing spacing issues.
// Detect them so we can shrink those names to keep consistent line height.

const EMOJI_RE = /[\u{1F300}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{FE00}-\u{FE0F}\u{200D}\u{1F1E0}-\u{1F1FF}]/u;

function hasEmoji(str) {
  return EMOJI_RE.test(str);
}

// ── Render Supporters ───────────────────────────────────────────────────────
// Layout matched to original Patreon poster:
//   - Top 13%: reserved for title/icons (transparent in our PNG)
//   - Bottom 6%: reserved for footer
//   - Sides 2.5%: margin
//   - Names fill the remaining 81% of height evenly
//   - 8 columns, centre-aligned, column-first order
//   - Font as large as possible without overflow

function renderSupporters(names) {
  const W = S_WIDTH, H = S_HEIGHT;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = S_COLOR;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const cols = S_COLS;
  const perCol = Math.ceil(names.length / cols);

  const marginTop    = Math.round(H * 0.13);
  const marginBottom = Math.round(H * 0.06);
  const marginSide   = Math.round(W * 0.025);

  const availH = H - marginTop - marginBottom;
  const availW = W - marginSide * 2;
  const colW   = availW / cols;
  const maxTextW = colW - 8;

  // Font size based on even line height
  const evenLineH = availH / perCol;
  let fontSize = Math.floor(evenLineH * 0.7);
  if (fontSize < 10) fontSize = 10;
  if (fontSize > 28) fontSize = 28;
  const baseFont = fontSize + "px " + FONTS;

  // Emoji multiplier: emoji lines get 1.7x height for breathing room
  const EMOJI_MULT = 1.7;

  for (let c = 0; c < cols; c++) {
    const cx = marginSide + c * colW + colW / 2;

    // Gather names for this column
    const colNames = [];
    for (let r = 0; r < perCol; r++) {
      const i = c * perCol + r;
      if (i >= names.length) break;
      colNames.push({ name: names[i], emoji: hasEmoji(names[i]) });
    }

    // Calculate adaptive line heights for this column
    const numEmoji = colNames.filter(n => n.emoji).length;
    const numNormal = colNames.length - numEmoji;
    // Solve: availH = numNormal * baseH + numEmoji * baseH * EMOJI_MULT
    const baseH = availH / (numNormal + numEmoji * EMOJI_MULT);

    // Render each name at cumulative Y position
    let y = marginTop;
    for (const entry of colNames) {
      const rowH = entry.emoji ? baseH * EMOJI_MULT : baseH;

      // Full size font, only shrink for width overflow
      ctx.font = baseFont;
      const tw = ctx.measureText(entry.name).width;
      if (tw > maxTextW) {
        const shrunk = Math.max(8, Math.floor(fontSize * maxTextW / tw));
        ctx.font = shrunk + "px " + FONTS;
      }

      // Centre text vertically within its row
      const textY = y + (rowH - fontSize) / 2;
      ctx.fillText(entry.name, cx, textY);
      y += rowH;
    }
  }

  console.log("[Poster] Supporters: font=" + fontSize + "px perCol=" + perCol);
  return canvas.toBuffer("image/png");
}

// ── Render Boosters ─────────────────────────────────────────────────────────
// Layout matched to original Discord Boosters poster:
//   - Top 15%: reserved for icon/title
//   - Bottom 10%: reserved for footer
//   - Names fill the remaining 75% of height
//   - Single centred column
//   - Consistent fixed spacing

function renderBoosters(names) {
  const W = B_WIDTH, H = B_HEIGHT;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = B_COLOR;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const marginTop    = Math.round(H * 0.15);
  const marginBottom = Math.round(H * 0.10);
  const availH = H - marginTop - marginBottom;
  const cx = W / 2;

  // Font size from even line height
  const evenLineH = availH / Math.max(names.length, 1);
  let fontSize = Math.floor(evenLineH * 0.65);
  if (fontSize < 14) fontSize = 14;
  if (fontSize > 40) fontSize = 40;

  const EMOJI_MULT = 1.7;

  // Pre-scan for emojis
  const entries = names.map(n => ({ name: n, emoji: hasEmoji(n) }));
  const numEmoji = entries.filter(e => e.emoji).length;
  const numNormal = entries.length - numEmoji;
  const baseH = availH / (numNormal + numEmoji * EMOJI_MULT);

  let y = marginTop;
  for (const entry of entries) {
    const rowH = entry.emoji ? baseH * EMOJI_MULT : baseH;

    ctx.font = fontSize + "px " + FONTS;
    const textY = y + (rowH - fontSize) / 2;
    ctx.fillText(entry.name, cx, textY);
    y += rowH;
  }

  console.log("[Poster] Boosters: font=" + fontSize + "px count=" + names.length);
  return canvas.toBuffer("image/png");
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("[Poster] Fetching " + WORKER_URL);
  const res = await fetch(WORKER_URL);
  if (!res.ok) throw new Error("Worker returned " + res.status);
  const data = parse(await res.text());
  console.log("[Poster] " + data.s.length + " supporters, " + data.b.length + " boosters");

  // Safety: an empty response means the worker is broken or disabled.
  // Fail the run so the previous deployment stays live instead of
  // publishing blank walls.
  if (data.s.length === 0 && data.b.length === 0) {
    throw new Error("No names returned from worker — keeping previous deployment");
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "supporters.png"), renderSupporters(data.s));
  fs.writeFileSync(path.join(OUT_DIR, "boosters.png"), renderBoosters(data.b));
  console.log("[Poster] Wrote supporters.png + boosters.png to " + OUT_DIR + "/");
}

main().catch(err => {
  console.error("[Poster] FAILED:", err.message);
  process.exit(1);
});
