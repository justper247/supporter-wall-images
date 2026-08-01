// fetch-access.js
//
// Downloads the supporter access list from the worker into ./site so GitHub Pages
// serves it next to the wall images.
//
// Why this exists: VRChat refuses to download from workers.dev. It only allows a
// small set of trusted domains (github.io among them), which is the same reason the
// wall PNGs are published here rather than served straight from the worker.
//
// Safety: if the worker is unreachable or returns a broken list, this FAILS the run
// on purpose. A failed run leaves the previous Pages deployment in place, so the
// world keeps reading the last good list. Publishing an empty list instead would
// lock every supporter out of the avatar wall.

const fs = require("fs");
const path = require("path");

const URL = process.env.ACCESS_URL ||
  "https://supporter-wall.justper247.workers.dev/supporters.csv";
const OUT_DIR = process.env.OUT_DIR || "site";

(async () => {
  const res = await fetch(URL);
  if (!res.ok) throw new Error("worker returned HTTP " + res.status);

  const text = await res.text();
  const rows = text.trim().split("\n").filter(Boolean);
  if (rows.length === 0) throw new Error("empty response from worker");

  // Header is "Name" alone when auto-access is switched off, and
  // "Name,<Role>,..." when it is on. Only demand supporters in the second case,
  // otherwise turning access off would fail this run forever and block the wall
  // images from updating too.
  const accessOn = rows[0].includes(",");
  const supporters = rows.length - 1;
  if (accessOn && supporters === 0) {
    throw new Error("auto-access is on but the list is empty - refusing to publish");
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "supporters.csv"), text);
  console.log(
    "[Access] wrote supporters.csv - " +
    (accessOn ? supporters + " supporter(s)" : "auto-access is off, empty list")
  );
})().catch((err) => {
  console.error("[Access] " + err.message);
  process.exit(1);
});
