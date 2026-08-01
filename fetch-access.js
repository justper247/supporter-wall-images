// fetch-access.js
//
// Downloads the supporter access list from the worker into ./site so GitHub Pages
// serves it next to the wall images.
//
// Why this exists: VRChat refuses to download from workers.dev. It only allows a
// small set of trusted domains (github.io among them), which is the same reason the
// wall PNGs are published here rather than served straight from the worker.
//
// This step must NEVER fail the run. The supporter wall images and the world access
// list are independent features that happen to share a deployment - an access problem
// blocking the wall render (which is what happened on 2026-08-01) is worse than the
// access list being briefly stale.
//
// Order of preference:
//   1. a good fresh list from the worker
//   2. the list currently published on Pages (keeps access working during an outage)
//   3. nothing, with a loud warning - images still deploy

const fs = require("fs");
const path = require("path");

const WORKER_URL = process.env.ACCESS_URL ||
  "https://supporter-wall.justper247.workers.dev/supporters.csv";
const PUBLISHED_URL = process.env.PUBLISHED_ACCESS_URL ||
  "https://justper247.github.io/supporter-wall-images/supporters.csv";
const OUT_DIR = process.env.OUT_DIR || "site";

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.text();
}

// A successful response is AUTHORITATIVE, even with zero supporters - otherwise
// removing somebody's role could never revoke their access, because the last list
// that happened to contain them would be republished forever.
//
// The "don't publish garbage" guard lives in the worker instead, which is the only
// layer that can tell "nobody qualifies" apart from "Discord call failed".
// Here we only sanity-check the shape.
function looksValid(text) {
  const rows = text.trim().split("\n").filter(Boolean);
  return rows.length > 0 && rows[0].startsWith("Name");
}

function write(text, note) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "supporters.csv"), text);
  const rows = text.trim().split("\n").filter(Boolean).length - 1;
  console.log(`[Access] published supporters.csv (${rows} supporter(s)) - ${note}`);
}

(async () => {
  let fresh = null;
  try {
    fresh = await get(WORKER_URL);
  } catch (err) {
    console.warn("[Access] worker unreachable: " + err.message);
  }

  if (fresh !== null && looksValid(fresh)) {
    write(fresh, "fresh from worker");
    return;
  }

  if (fresh !== null) {
    console.warn("[Access] worker response was malformed - keeping the published one instead.");
  }

  // Only reached when the worker is unreachable or sent something unrecognisable.
  try {
    const previous = await get(PUBLISHED_URL);
    if (looksValid(previous)) {
      write(previous, "REUSED previously published list (worker unavailable)");
      return;
    }
    console.warn("[Access] previously published list is unusable too.");
  } catch (err) {
    console.warn("[Access] no previously published list: " + err.message);
  }

  // Nothing good to publish. Do not fail - the wall images must still deploy.
  console.warn(
    "[Access] WARNING: no supporters.csv published this run. The world will fall back " +
    "to its keypad until this is fixed."
  );
})().catch((err) => {
  // Even an unexpected crash must not block the wall deployment.
  console.warn("[Access] unexpected error, continuing: " + err.message);
});
