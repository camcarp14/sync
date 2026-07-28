// Renders public/icons/icon.svg into the PNG sizes iOS and Android insist on.
// Run once when the mark changes; the outputs are committed.
//
//   node scripts/make-icons.mjs
//
// Needs Playwright available (globally is fine):
//   NODE_PATH=$(npm root -g) node scripts/make-icons.mjs

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(here, "..", "public", "icons");

// Playwright is a one-off tool for this script, not a dependency of the app.
// Try the local resolution first, then the global install, so `npm i -g
// playwright` is enough and the app's own package.json stays clean.
async function loadPlaywright() {
  try { return await import("playwright"); } catch { /* not local */ }
  const { execSync } = await import("node:child_process");
  const root = execSync("npm root -g", { encoding: "utf8" }).trim();
  return import(new URL(`file://${join(root, "playwright", "index.mjs")}`).href)
    .catch(() => import(new URL(`file://${join(root, "playwright", "index.js")}`).href));
}

const { chromium } = await loadPlaywright();

const svg = await readFile(join(iconsDir, "icon.svg"), "utf8");

// Maskable icons need the mark inside the safe zone — Android crops to a
// circle at 80%, so the artwork is scaled to 76% on a full-bleed background.
const maskable = svg
  .replace('<rect width="512" height="512" rx="112"', '<rect width="512" height="512" rx="0"')
  .replace(/<g fill="none"/g, '<g transform="translate(61.44 61.44) scale(0.76)" fill="none"')
  .replace(/<circle cx="256" cy="256" r="52"/, '<circle transform="translate(61.44 61.44) scale(0.76)" cx="256" cy="256" r="52"');

const TARGETS = [
  { file: "icon-180.png", size: 180, source: svg },
  { file: "icon-192.png", size: 192, source: svg },
  { file: "icon-512.png", size: 512, source: svg },
  { file: "icon-512-maskable.png", size: 512, source: maskable },
];

const browser = await chromium.launch();
const page = await browser.newPage();

for (const { file, size, source } of TARGETS) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source}`,
    { waitUntil: "load" }
  );
  const buf = await page.screenshot({ omitBackground: true, type: "png" });
  await writeFile(join(iconsDir, file), buf);
  console.log(`wrote ${file} (${size}×${size}, ${buf.length} bytes)`);
}

await browser.close();
