// ─── The loop that matters, in a real browser ────────────────────────────────
// Builds nothing, mocks nothing except the Anthropic endpoint itself: the real
// bundle, the real store, the real voice provider. It proves the one thing the
// unit tests can't — that an utterance goes in and the day actually changes,
// with a working Undo attached.
//
//   npm run build && npm run e2e
//
// Playwright is a dev-only tool for this file, not a dependency of the app:
//   npm i -g playwright   (Chromium must already be installed)

import { spawn, execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const SHOTS = join(repo, "shots");
const PORT = 4178;
const URL = `http://127.0.0.1:${PORT}/`;

async function loadPlaywright() {
  try { return await import("playwright"); } catch { /* not local */ }
  const root = execSync("npm root -g", { encoding: "utf8" }).trim();
  return import(`file://${join(root, "playwright", "index.mjs")}`)
    .catch(() => import(`file://${join(root, "playwright", "index.js")}`));
}

/* ── harness ───────────────────────────────────────────────────────────────── */
let passed = 0;
const failures = [];
const check = (name, cond, detail) => {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
};

const sse = (frames) => frames.map((f) => `event: ${f.type}\ndata: ${JSON.stringify(f)}\n\n`).join("");

// Round one: the model calls schedule_block. Round two: it speaks.
const TURN_TOOL = sse([
  { type: "message_start", message: { usage: { input_tokens: 900 } } },
  { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu_1", name: "schedule_block", input: {} } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"title":"Deep work' } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '","start":"14:00","mins":90,"kind":"deep"}' } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 60 } },
  { type: "message_stop" },
]);

const TURN_TEXT = sse([
  { type: "message_start", message: { usage: { input_tokens: 1000 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Booked. Two till three-thirty, " } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "and nothing else was in the way." } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 30 } },
  { type: "message_stop" },
]);

/* ── serve the built bundle ────────────────────────────────────────────────── */
const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--host", "127.0.0.1"], {
  cwd: repo, stdio: "ignore", detached: false,
});
const shutdown = () => { try { server.kill("SIGTERM"); } catch { /* already gone */ } };
process.on("exit", shutdown);
process.on("SIGINT", () => { shutdown(); process.exit(130); });

async function waitForServer(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(URL);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`preview server never came up on ${URL} — did you run "npm run build"?`);
}

await waitForServer();
mkdirSync(SHOTS, { recursive: true });

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
const page = await ctx.newPage();

const sent = [];
let call = 0;
await page.route("https://api.anthropic.com/**", async (route) => {
  sent.push(JSON.parse(route.request().postData() || "{}"));
  await route.fulfill({
    status: 200,
    headers: { "content-type": "text/event-stream" },
    body: call++ === 0 ? TURN_TOOL : TURN_TEXT,
  });
});

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
// A stubbed 401 makes the browser log a network error. That is the path under
// test, not a defect — only genuine script errors count.
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
});

await page.addInitScript(() => {
  localStorage.setItem("sync.state.v1", JSON.stringify({
    v: 1,
    settings: { theme: "night", apiKey: "sk-ant-test", model: "sonnet", speak: false, ambient: false, wakeWord: "sync", rate: 1, pitch: 1, webSearch: false, onboarded: true },
    profile: { name: "Cameron", role: "", workStart: 480, workEnd: 1080, ventures: [], directives: [] },
  }));
});

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(2200);   // the boot animation clears

const readState = () => page.evaluate(() => JSON.parse(localStorage.getItem("sync.state.v1")));

/* ── a turn that changes the day ───────────────────────────────────────────── */
await page.fill('textarea[aria-label="Message SYNC"]', "Book me two hours of deep work at two.");
await page.keyboard.press("Enter");
await page.waitForTimeout(2500);

let s = await readState();

check("the tool round trip took two calls", sent.length === 2, `saw ${sent.length}`);
check("the tools were offered", (sent[0].tools || []).some((t) => t.name === "schedule_block"));
check("web search was omitted while off", !(sent[0].tools || []).some((t) => t.name === "web_search"));
check("the system prompt carried live context", /LIVE CONTEXT/.test(sent[0].system || ""));
check("the second call returned the tool result", JSON.stringify(sent[1].messages).includes("tool_result"));

check("a block was actually created", s.blocks.length === 1, `blocks=${s.blocks.length}`);
check("with the right title", s.blocks[0]?.title === "Deep work", s.blocks[0]?.title);
check("at the right time", s.blocks[0]?.start === 840, String(s.blocks[0]?.start));
check("for the right duration", s.blocks[0]?.mins === 90, String(s.blocks[0]?.mins));
check("the action reached the ledger", s.ledger.length === 1);
check("the ledger entry can be undone", !!s.ledger[0]?.undo);
check("usage was recorded", s.usage.calls === 2, `calls=${s.usage.calls}`);

check("the reply rendered", /Booked\. Two till three-thirty/.test(await page.locator(".turn-sync .say").last().innerText()));
check("the action shows in the strip", /Scheduled/.test(await page.locator(".act .act-title").last().innerText()));
await page.screenshot({ path: join(SHOTS, "e2e-1-turn.png") });

/* ── undo puts it back ─────────────────────────────────────────────────────── */
await page.locator(".act-undo").last().click();
await page.waitForTimeout(700);
s = await readState();
check("undo removed the block", s.blocks.length === 0, `blocks=${s.blocks.length}`);
check("undo marked the entry", s.ledger[0]?.undone === true);
check("undo confirmed with a toast", (await page.locator(".toast").count()) > 0);
await page.screenshot({ path: join(SHOTS, "e2e-2-undo.png") });

/* ── the Day page agrees with the store ────────────────────────────────────── */
await page.locator(".side-item").filter({ hasText: "Day" }).first().click();
await page.waitForTimeout(700);
check("the day reads empty again", /empty/i.test(await page.locator(".empty-title").first().innerText()));

/* ── the command palette runs commands ─────────────────────────────────────── */
await page.keyboard.press("Meta+k");
await page.waitForTimeout(400);
check("⌘K opens the palette", (await page.locator(".cmdk").count()) === 1);
await page.keyboard.type("quartz");
await page.waitForTimeout(300);
check("the palette filters", (await page.locator(".cmdk-item").count()) >= 1);
await page.keyboard.press("Enter");
await page.waitForTimeout(600);
check("a matched command runs on return", (await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "day");

/* ── a rejected key is explained, with a retry ─────────────────────────────── */
await page.locator(".side-item").filter({ hasText: "Console" }).first().click();
await page.waitForTimeout(400);
await page.unroute("https://api.anthropic.com/**");
await page.route("https://api.anthropic.com/**", (route) =>
  route.fulfill({ status: 401, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: { message: "invalid x-api-key" } }) }));

await page.fill('textarea[aria-label="Message SYNC"]', "This one will fail.");
await page.keyboard.press("Enter");
await page.waitForTimeout(1600);
check("a rejected key is explained in plain words", /key was rejected/i.test(await page.locator(".act.failed .act-title").last().innerText()));
check("the failure carries a retry", (await page.locator(".act.failed .act-undo").count()) > 0);
await page.screenshot({ path: join(SHOTS, "e2e-3-error.png") });

check("nothing threw", errors.length === 0, errors.join(" | "));

/* ── phone geometry, including an installed iOS app ────────────────────────── */
// This block exists because two separate safe-area fixes shipped broken and
// neither produced an error: the first was overridden by a `padding` shorthand
// further down the stylesheet, and nothing in the build or the unit tests can
// see that. Only measuring the rendered box catches it, so it is measured.
async function phoneGeometry(installed, { shortViewport = false } = {}) {
  const c = await browser.newContext({
    // shortViewport reproduces the condition that actually broke this app: an
    // installed iOS web view that owns the whole 852pt screen while reporting
    // a layout viewport of 759 — the screen less the status bar and the home
    // indicator. Anything sized to the viewport, `inset: 0` included, then
    // stops 93px short of the glass.
    viewport: { width: 393, height: shortViewport ? 759 : 852 },
    screen: { width: 393, height: installed ? 852 : 932 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "light",
  });
  const pg = await c.newPage();
  await pg.addInitScript((inst) => {
    localStorage.setItem("sync.state.v1", JSON.stringify({
      v: 1,
      settings: { theme: "day", apiKey: "", model: "sonnet", speak: true, ambient: false, wakeWord: "sync", rate: 1, pitch: 1, webSearch: true, onboarded: true },
      profile: { name: "Cameron", role: "", workStart: 480, workEnd: 1080, ventures: [], directives: [] },
    }));
    if (inst) Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
  }, installed);
  await pg.goto(URL, { waitUntil: "networkidle" });
  await pg.waitForTimeout(2400);
  const m = await pg.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const top = (sel) => { const b = document.querySelector(sel)?.getBoundingClientRect(); return b ? Math.round(b.top) : null; };
    const dock = document.querySelector(".dock")?.getBoundingClientRect();
    // What is actually painted at the bottom edge of the screen. A bounding
    // box is not enough: an element clipped out of view still reports the box
    // it would have occupied, which is how the first version of this check
    // passed against a layout that was visibly broken.
    const atBottom = document.elementFromPoint(Math.round(window.innerWidth / 2), window.innerHeight - 6);
    const atTop = document.elementFromPoint(Math.round(window.innerWidth / 2), 4);
    return {
      capH: Math.round(document.querySelector(".notch-cap")?.getBoundingClientRect().height ?? -1),
      envTop: (() => {
        const el = document.createElement("div");
        el.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:env(safe-area-inset-top);";
        document.body.appendChild(el);
        const h = Math.round(el.getBoundingClientRect().height);
        el.remove();
        return h;
      })(),
      innerH: window.innerHeight,
      barTop: top(".console-bar"),
      orbTop: top(".orb-canvas"),
      dockBottom: dock ? Math.round(dock.bottom) : null,
      dockAtBottomEdge: !!atBottom?.closest(".dock"),
      screenH: window.screen.height,
      vvh: window.visualViewport ? Math.round(window.visualViewport.height) : null,
      dockBottomOnScreen: Math.round(document.querySelector(".dock")?.getBoundingClientRect().bottom ?? -1),
      appAtTopEdge: !!atTop?.closest(".app"),
      streamTop: document.querySelector(".stream")?.scrollTop ?? null,
    };
  });
  await pg.screenshot({ path: join(SHOTS, installed ? "e2e-4-installed.png" : "e2e-5-tab.png") });
  await c.close();
  return m;
}

const inst = await phoneGeometry(true);
// The status-bar zone is reserved by an element, not by padding on a rule that
// a later shorthand can silently reset — which is how two earlier fixes died.
// Headless Chromium reports a zero inset, so what is asserted is the invariant
// that holds at any inset: the reservation equals what the platform reports,
// and the content starts after it.
check("installed: the status-bar zone is reserved by an element", inst.capH >= 0, "no .notch-cap");
check("installed: the reservation matches the reported inset", inst.capH === inst.envTop, `cap ${inst.capH} vs inset ${inst.envTop}`);
check("installed: the toggle row starts below the reservation", inst.barTop >= inst.capH, `${inst.barTop} vs ${inst.capH}`);
check("installed: the frame reaches the top edge", inst.appAtTopEdge, "nothing from .app is painted at y=4");
check("installed: the tab bar is painted at the bottom edge", inst.dockAtBottomEdge, "the bottom of the screen is not the dock");
check("installed: the tab bar sits on the renderable bottom", inst.dockBottomOnScreen === inst.vvh, `${inst.dockBottomOnScreen} vs ${inst.vvh}`);
check("installed: the opening card is not scrolled off the top", inst.streamTop === 0, String(inst.streamTop));

// The regression that took four attempts to land: a full-screen web view with
// a short layout viewport. This assertion fails on every build before it.
const short = await phoneGeometry(true, { shortViewport: true });
// The invariant is the RENDERABLE bottom, not the screen. An earlier version of
// this check asserted screen.height and so enshrined the bug: iOS clips
// everything below visualViewport, and a frame sized past it pushes the tab bar
// into the clipped region — which is how "fixed" made the gap bigger, not
// smaller.
check("short viewport: the tab bar sits on the renderable bottom", short.dockBottomOnScreen === short.vvh,
  `dock bottom ${short.dockBottomOnScreen} vs renderable ${short.vvh}`);
check("short viewport: the frame never exceeds what can be drawn", short.dockBottomOnScreen <= short.vvh,
  `dock bottom ${short.dockBottomOnScreen} vs renderable ${short.vvh}`);

// Onboarding must be completable on a phone. It was not: the entrance had no
// definite height, so `body { overflow: hidden }` clipped anything past the
// screen and the Start button could not be reached — which is why the
// questions came back every launch. The answers were never saved because the
// flow could never be finished.
{
  const c = await browser.newContext({
    viewport: { width: 393, height: 759 }, screen: { width: 393, height: 852 },
    deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: "light",
  });
  const pg = await c.newPage();
  await pg.addInitScript(() => { Object.defineProperty(navigator, "standalone", { value: true, configurable: true }); });
  await pg.goto(URL, { waitUntil: "networkidle" });
  await pg.waitForTimeout(2400);

  await pg.fill('input[placeholder="Cameron"]', "Cameron");
  await pg.getByRole("button", { name: "Continue" }).click();
  await pg.waitForTimeout(400);
  await pg.getByRole("button", { name: /Skip for now|Continue/ }).click();
  await pg.waitForTimeout(500);

  const start = pg.getByRole("button", { name: "Start" });
  await start.scrollIntoViewIfNeeded();
  const box = await start.boundingBox();
  check("onboarding: the Start button can be reached on a phone",
    !!box && box.y >= 0 && box.y + box.height <= 759, JSON.stringify(box));

  await start.click();
  await pg.waitForTimeout(1000);
  const saved = await pg.evaluate(() => JSON.parse(localStorage.getItem("sync.state.v1") || "null"));
  check("onboarding: finishing it persists", saved?.settings?.onboarded === true, String(saved?.settings?.onboarded));
  check("onboarding: the answers persist", saved?.profile?.name === "Cameron" && saved?.profile?.ventures?.length > 0,
    `${saved?.profile?.name} / ${saved?.profile?.ventures?.length} ventures`);

  await pg.reload({ waitUntil: "networkidle" });
  await pg.waitForTimeout(2400);
  check("onboarding: it does not ask again after a reload", (await pg.locator(".entrance").count()) === 0);
  await c.close();
}

const tab = await phoneGeometry(false);
check("browser tab: nothing is reserved when there is no inset", tab.capH === tab.envTop, `cap ${tab.capH} vs inset ${tab.envTop}`);
check("browser tab: no dead band above the toggles", tab.barTop <= 14, String(tab.barTop));
check("browser tab: the tab bar is painted at the bottom edge", tab.dockAtBottomEdge, "the bottom of the screen is not the dock");

// NOTE: the iOS bottom-gap this app hit cannot be reproduced here. Chromium's
// initial containing block is correct, and `overflow:hidden` on body propagates
// to the viewport so nothing clips — a deliberately-shortened height chain
// renders identically to a correct one. The fix for it (a fixed frame pinned to
// all four edges) removes the dependency rather than correcting a value, so
// there is nothing here that can meaningfully assert it. Said plainly rather
// than covered by a check that passes either way.

await browser.close();
shutdown();

if (failures.length) {
  console.error(`\n✗ e2e: ${failures.length} failed, ${passed} passed`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`✓ e2e: ${passed} checks passed`);
process.exit(0);
