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

await browser.close();
shutdown();

if (failures.length) {
  console.error(`\n✗ e2e: ${failures.length} failed, ${passed} passed`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(`✓ e2e: ${passed} checks passed`);
process.exit(0);
