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

// ── Name layout ─────────────────────────────────────────────────────────────
// Every name gets the same slot height and sits on the same baseline inside it, so plain
// names line up perfectly. Names keep exactly the characters their owners chose; only
// names that wouldn't fit adapt:
//   - too wide for the column, or taller than the slot (stacked accent marks): shrink
//   - poking above or below the slot (emoji, fancy letters): nudged back inside it
// Emoji names used to get a 1.7x taller row, which left big gaps around them, and tall
// names were allowed to overlap the next one.

const SLOT_FILL = 0.95;   // visible text may use up to 95% of its slot's height

function drawName(ctx, name, cx, slotTop, slotH, fontSize, maxW, minSize) {
  let size = fontSize;
  let m;
  for (let i = 0; i < 20; i++) {
    ctx.font = size + "px " + FONTS;
    m = ctx.measureText(name);
    const inkH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
    const scale = Math.min(1, maxW / Math.max(m.width, 1), (slotH * SLOT_FILL) / Math.max(inkH, 1));
    if (scale >= 1 || size <= minSize) break;
    size = Math.max(minSize, Math.floor(size * scale));
  }

  // Normal baseline: centre ordinary text ("Hg" = capitals plus descenders) in the slot.
  const ref = ctx.measureText("Hg");
  let baseline = slotTop + slotH / 2 + (ref.actualBoundingBoxAscent - ref.actualBoundingBoxDescent) / 2;

  // Nudge anything that pokes out of its own slot back inside, so it never touches a
  // neighbour.
  const inkTop = baseline - m.actualBoundingBoxAscent;
  const inkBottom = baseline + m.actualBoundingBoxDescent;
  if (inkTop < slotTop) baseline += slotTop - inkTop;
  else if (inkBottom > slotTop + slotH) baseline -= inkBottom - (slotTop + slotH);

  ctx.fillText(name, cx, baseline);
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
  ctx.textBaseline = "alphabetic";

  const cols = S_COLS;
  const perCol = Math.ceil(names.length / cols);

  const marginTop    = Math.round(H * 0.13);
  const marginBottom = Math.round(H * 0.06);
  const marginSide   = Math.round(W * 0.025);

  const availH = H - marginTop - marginBottom;
  const availW = W - marginSide * 2;
  const colW   = availW / cols;
  const maxTextW = colW - 8;

  // One slot per row, the same height everywhere, so rows line up across columns
  const slotH = availH / perCol;
  let fontSize = Math.floor(slotH * 0.7);
  if (fontSize < 10) fontSize = 10;
  if (fontSize > 28) fontSize = 28;

  for (let c = 0; c < cols; c++) {
    const cx = marginSide + c * colW + colW / 2;
    for (let r = 0; r < perCol; r++) {
      const i = c * perCol + r;
      if (i >= names.length) break;
      drawName(ctx, names[i], cx, marginTop + r * slotH, slotH, fontSize, maxTextW, 8);
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
  ctx.textBaseline = "alphabetic";

  const marginTop    = Math.round(H * 0.15);
  const marginBottom = Math.round(H * 0.10);
  const availH = H - marginTop - marginBottom;
  const cx = W / 2;

  // One slot per name, all the same height
  const slotH = availH / Math.max(names.length, 1);
  let fontSize = Math.floor(slotH * 0.65);
  if (fontSize < 14) fontSize = 14;
  if (fontSize > 40) fontSize = 40;

  names.forEach((name, i) => {
    drawName(ctx, name, cx, marginTop + i * slotH, slotH, fontSize, W * 0.9, 10);
  });

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
