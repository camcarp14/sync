// The store's contract: every mutation is undoable, persistence survives a
// reload, and a corrupt or partial saved state never stops the app booting.

import { installBrowserEnv, check, eq, report } from "./_env.mjs";
installBrowserEnv();

const store = await import("../src/data/store.js");

/* ── shape ─────────────────────────────────────────────────────────────────── */
const s0 = store.getState();
eq("schema version", s0.v, 1);
check("starts with an empty plan", Array.isArray(s0.blocks) && s0.blocks.length === 0);
check("starts with an empty ledger", s0.ledger.length === 0);
eq("defaults to auto theme", s0.settings.theme, "auto");

/* ── subscribe fires on every commit ───────────────────────────────────────── */
let notified = 0;
const off = store.subscribe(() => notified++);

/* ── commit → ledger → undo ────────────────────────────────────────────────── */
const entry = store.commit({
  action: "add_tasks",
  title: "Captured two tasks",
  detail: "a · b",
  touches: ["tasks"],
  apply: (s) => ({ tasks: [...s.tasks, { id: "k1", title: "a", status: "open" }, { id: "k2", title: "b", status: "open" }] }),
});

eq("commit applied the patch", store.getState().tasks.length, 2);
eq("commit filed a ledger entry", store.getState().ledger.length, 1);
check("ledger entry carries a before-image", !!entry.undo && Array.isArray(entry.undo.tasks));
eq("before-image is the pre-commit value", entry.undo.tasks.length, 0);
check("subscribers were notified", notified > 0);

// A second commit on the same collection, so undo has to restore the middle
// state rather than "empty".
store.commit({
  action: "update_task",
  title: "Closed a",
  touches: ["tasks"],
  apply: (s) => ({ tasks: s.tasks.map((t) => (t.id === "k1" ? { ...t, status: "done" } : t)) }),
});
eq("second commit landed", store.getState().tasks.find((t) => t.id === "k1").status, "done");

eq("undo of the second commit", store.undo(store.getState().ledger[1].id), true);
eq("undo restored the intermediate state", store.getState().tasks.find((t) => t.id === "k1").status, "open");
eq("undo left both tasks in place", store.getState().tasks.length, 2);
eq("undoing twice is a no-op", store.undo(store.getState().ledger[1].id), false);
eq("undo marked the entry", store.getState().ledger[1].undone, true);
eq("undo of an unknown id is a no-op", store.undo("nope"), false);

eq("undo of the first commit", store.undo(entry.id), true);
eq("first undo emptied the tasks again", store.getState().tasks.length, 0);

/* ── a read-only commit is filed but not undoable ──────────────────────────── */
const ro = store.commit({ action: "write_brief", title: "Filed a brief", touches: [], apply: () => ({}) });
eq("no touches means no undo image", ro.undo, null);

/* ── transcript ────────────────────────────────────────────────────────────── */
const t = store.addTurn({ role: "user", text: "plan my day" });
check("addTurn returns an id", !!t.id);
store.patchTurn(t.id, { text: "edited" });
eq("patchTurn edits in place", store.getState().turns.find((x) => x.id === t.id).text, "edited");
store.patchTurn(t.id, (prev) => ({ text: prev.text + "!" }));
eq("patchTurn accepts a function", store.getState().turns.find((x) => x.id === t.id).text, "edited!");

/* ── usage accumulates ─────────────────────────────────────────────────────── */
store.addUsage({ inTok: 1000, outTok: 500, cost: 0.01 });
store.addUsage({ inTok: 1000, outTok: 500, cost: 0.01 });
eq("usage calls", store.getState().usage.calls, 2);
eq("usage input tokens", store.getState().usage.in, 2000);
check("usage cost", Math.abs(store.getState().usage.cost - 0.02) < 1e-9);

/* ── export never carries the key ──────────────────────────────────────────── */
store.setSettings({ apiKey: "sk-ant-secret-value" });
const dump = store.exportState();
check("export omits the API key", !dump.includes("sk-ant-secret-value"));
check("export includes the rest of state", dump.includes("\"tasks\""));

/* ── import replaces state but keeps the key ───────────────────────────────── */
store.importState(JSON.stringify({
  v: 1,
  tasks: [{ id: "x", title: "imported", status: "open" }],
  settings: { model: "opus" },
}));
eq("import replaced tasks", store.getState().tasks.length, 1);
eq("import kept the local key", store.getState().settings.apiKey, "sk-ant-secret-value");
eq("import merged settings over defaults", store.getState().settings.model, "opus");
check("import filled in missing collections", Array.isArray(store.getState().followups));
check("import filled in missing profile", Array.isArray(store.getState().profile.ventures));

/* ── reset ─────────────────────────────────────────────────────────────────── */
store.resetAll({ keepKey: true });
eq("reset cleared tasks", store.getState().tasks.length, 0);
eq("reset kept the key", store.getState().settings.apiKey, "sk-ant-secret-value");
eq("reset marks onboarding done", store.getState().settings.onboarded, true);

store.resetAll({ keepKey: false });
eq("reset can drop the key too", store.getState().settings.apiKey, "");

/* ── derived reads ─────────────────────────────────────────────────────────── */
const { dayKey } = await import("../src/lib/time.js");
const today = dayKey();
store.set({
  blocks: [
    { id: "b2", day: today, start: 600, mins: 60, title: "second", status: "planned" },
    { id: "b1", day: today, start: 540, mins: 30, title: "first", status: "planned" },
    { id: "b3", day: "2000-01-01", start: 540, mins: 30, title: "other day", status: "planned" },
  ],
  tasks: [{ id: "k1", title: "open", status: "open" }, { id: "k2", title: "shut", status: "done" }],
  followups: [
    { id: "f1", who: "A", status: "open", due: "2000-01-01" },
    { id: "f2", who: "B", status: "open", due: null },
  ],
});
eq("blocksFor filters by day", store.blocksFor(store.getState(), today).length, 2);
eq("blocksFor sorts by start", store.blocksFor(store.getState(), today).map((b) => b.id), ["b1", "b2"]);
eq("openTasks excludes done", store.openTasks(store.getState()).length, 1);
eq("overdueFollowups finds the stale one", store.overdueFollowups(store.getState(), today).map((f) => f.id), ["f1"]);
eq("currentBlock at 9:15", store.currentBlock(store.getState(), today, 555)?.id, "b1");
eq("currentBlock in a gap", store.currentBlock(store.getState(), today, 585), null);
eq("nextBlock from a gap", store.nextBlock(store.getState(), today, 585)?.id, "b2");
eq("nextBlock after everything", store.nextBlock(store.getState(), today, 1400), null);

off();

/* ── a corrupt saved state must never stop the boot ────────────────────────── */
// The module reads storage once at import, so this is checked by re-importing
// with a poisoned value under a cache-busting query.
globalThis.localStorage.setItem("sync.state.v1", "{ this is not json");
const reloaded = await import("../src/data/store.js?corrupt");
check("corrupt storage still boots", reloaded.getState().v === 1);
eq("corrupt storage starts empty", reloaded.getState().tasks.length, 0);

// A state saved by an older build is missing keys this build reads.
globalThis.localStorage.setItem("sync.state.v1", JSON.stringify({ v: 1, tasks: [{ id: "old", title: "kept", status: "open" }] }));
const migrated = await import("../src/data/store.js?partial");
eq("partial state keeps what it had", migrated.getState().tasks.length, 1);
check("partial state gains what it lacked", Array.isArray(migrated.getState().briefs));
check("partial state gains default settings", typeof migrated.getState().settings.model === "string");

report("store");
