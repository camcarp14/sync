// The Pentagon connector, exercised without a network. What matters here is the
// contract around the network call, not the call itself: that the model can only
// name a source that exists, that a signed-out session fails with something a
// person can act on rather than a stack trace, and that a tool which created a
// row upstream files a ledger entry Undo can actually reach.

import { installBrowserEnv, check, eq, report } from "./_env.mjs";
installBrowserEnv();

const store = await import("../src/data/store.js");
const { runTool, TOOLS, toolDefs } = await import("../src/agent/tools.js");
const {
  SOURCES, SOURCE_KEYS, sourceMeta, isPersonal, sourceCatalogue, summarise, daysUntilBirthday,
} = await import("../src/agent/pentagon-sources.js");

/* ── the registry ──────────────────────────────────────────────────────────── */
check("there are sources", SOURCES.length > 0);
eq("keys are unique", SOURCE_KEYS.length, new Set(SOURCE_KEYS).size);
check("every source is scoped", SOURCES.every((s) => s.scope === "personal" || s.scope === "business"));
check("every source is described for the model", SOURCES.every((s) => s.desc && s.desc.length > 20));
check("calendar is personal", isPersonal("calendar"));
check("prospects is not", !isPersonal("prospects"));
eq("an unknown source has no metadata", sourceMeta("nonsense"), null);

// The catalogue is inlined into the tool description, so a source the model
// can name but can't read about is a source it will misuse.
const cat = sourceCatalogue();
check("the catalogue covers every key", SOURCE_KEYS.every((k) => cat.includes(`· ${k} —`)));

/* ── the tool surface ──────────────────────────────────────────────────────── */
const defs = toolDefs({ webSearch: false });
const readDef = defs.find((d) => d.name === "pentagon_read");
check("pentagon_read is offered to the model", !!readDef);
eq("its source list is exactly the registry", readDef.input_schema.properties.source.enum, SOURCE_KEYS);
eq("source is required", readDef.input_schema.required, ["source"]);
check("pentagon_read is marked readonly", TOOLS.pentagon_read.readonly === true);
check("the writes are not", !TOOLS.pentagon_add_event.readonly && !TOOLS.pentagon_capture.readonly);

// Every Pentagon tool crosses a network, so each must hand back a promise —
// runTool stays synchronous for the local ones and callers await either.
for (const name of ["pentagon_read", "pentagon_add_event", "pentagon_capture"]) {
  const out = runTool(name, name === "pentagon_read" ? { source: "calendar" } : { title: "x", kind: "note", body: "x" });
  check(`${name} returns a promise`, out && typeof out.then === "function");
}

/* ── signed out, every one of them fails legibly ───────────────────────────── */
const ledgerBefore = store.getState().ledger.length;

const reads = await runTool("pentagon_read", { source: "calendar" });
eq("reading while signed out fails", reads.ok, false);
check("and says what to do about it", /sign in/i.test(reads.summary), reads.summary);

const bogus = await runTool("pentagon_read", { source: "definitely_not_a_source" });
eq("an unknown source is refused", bogus.ok, false);

const wrote = await runTool("pentagon_add_event", { title: "Dentist", start: "2pm" });
eq("writing while signed out fails", wrote.ok, false);
const captured = await runTool("pentagon_capture", { kind: "grocery", body: "milk" });
eq("capturing while signed out fails", captured.ok, false);

eq("a failed Pentagon call files nothing in the ledger", store.getState().ledger.length, ledgerBefore);

/* ── remote undo actually reaches across ───────────────────────────────────── */
// commit() carries the descriptor; undo() hands it to whatever cloud.js
// registered. Proven here with a stub, because the wiring is the fragile part.
const seen = [];
store.setRemoteUndoHandler((remote) => { seen.push(remote); });

const entry = store.commit({
  action: "pentagon_add_event",
  title: "Calendar · Dentist",
  touches: [],
  remote: { schema: "boardroom", table: "personal_events", id: "abc-123", op: "insert" },
  apply: () => ({}),
});
check("the ledger entry carries the remote row", entry.remote?.id === "abc-123");
eq("undo succeeds even with no local before-image", store.undo(entry.id), true);
eq("and the remote half was dispatched", seen.length, 1);
eq("with the row to delete", seen[0].id, "abc-123");
eq("undoing twice does nothing more", store.undo(entry.id), false);
eq("and does not re-dispatch", seen.length, 1);

/* ── what actually leaves the device ───────────────────────────────────────── */
// The single most important property in this file. The Anthropic key lives in
// the same settings object as the theme and the wake word, one spread away from
// being uploaded to a shared database. Assert it, don't trust it.
const cloud = await import("../src/data/cloud.js");

store.setSettings({ apiKey: "sk-ant-secret", model: "opus", wakeWord: "atlas" });
store.commit({ action: "t", title: "t", touches: ["notes"], apply: (s) => ({ notes: [...s.notes, { id: "n1", text: "hi" }] }) });

const doc = cloud.buildDoc(store.getState());
check("the API key never travels", !("apiKey" in doc.settings));
check("and is nowhere in the payload at all", !JSON.stringify(doc).includes("sk-ant-secret"));
eq("the rest of settings does travel", doc.settings.model, "opus");
eq("so does the wake word", doc.settings.wakeWord, "atlas");
check("and the collections", doc.notes.length === 1);
for (const k of ["profile", "blocks", "tasks", "followups", "notes", "memory", "decisions", "drafts", "ledger", "briefs", "usage"]) {
  check(`${k} is carried`, doc[k] !== undefined);
}

// The unbounded collections travel trimmed, or a long-running install
// eventually pushes a document too big to store.
store.set({ turns: Array.from({ length: 400 }, (_, i) => ({ id: `t${i}` })) });
eq("the transcript is capped", cloud.buildDoc(store.getState()).turns.length, 120);
eq("and keeps the newest", cloud.buildDoc(store.getState()).turns.at(-1).id, "t399");

// The signature is what decides whether there is anything to push.
const snap = store.getState();
eq("the same state signs the same twice", cloud.sig(cloud.buildDoc(snap)), cloud.sig(cloud.buildDoc(snap)));
check("different content signs differently", cloud.sig({ a: 1 }) !== cloud.sig({ a: 2 }));
store.set({ notes: [{ id: "n2", text: "changed" }] });
check("a real edit changes the signature", cloud.sig(cloud.buildDoc(store.getState())) !== cloud.sig(cloud.buildDoc(snap)));

// A pulled document must not bring someone else's absent key with it and wipe
// the one on this device.
cloud.applyDoc({ settings: { model: "haiku" }, notes: [], tasks: [] });
eq("a pulled doc keeps the local key", store.getState().settings.apiKey, "sk-ant-secret");
eq("and adopts the remote settings", store.getState().settings.model, "haiku");
eq("and the remote collections", store.getState().notes.length, 0);

/* ── summaries are for the ear ─────────────────────────────────────────────── */
eq("an empty calendar", summarise("calendar", []), "Nothing on the calendar");
eq("one event names it", summarise("calendar", [{ title: "Dentist" }]), "1 event — Dentist");
eq("notes pluralise", summarise("notes", [{}, {}]), "2 notes");
eq("one note does not", summarise("notes", [{}]), "1 note");
eq("upkeep counts what's due", summarise("upkeep", [{ due: true }, { due: false }]), "1 upkeep item due");
eq("a clear grocery list says so", summarise("groceries", []), "Grocery list is clear");
check("the pipeline reads as a sentence", summarise("pipeline", { prospects: 27, new_leads: 2, replies_7d: 3 }).includes("27 prospects"));
eq("findings flag the serious ones", summarise("findings", [{ severity: "high" }, { severity: "low" }]), "2 findings, 1 serious");

/* ── birthdays wrap the year ───────────────────────────────────────────────── */
const jun15 = new Date(2026, 5, 15);
eq("today is zero days away", daysUntilBirthday(6, 15, jun15), 0);
eq("later this year counts forward", daysUntilBirthday(6, 25, jun15), 10);
check("already past rolls to next year", daysUntilBirthday(1, 1, jun15) > 180);

report("pentagon");

// Unlike the other suites, this one instantiates a real Supabase client, and a
// live client holds a token-refresh timer open forever — correct in a browser,
// fatal to a CI run. Nothing is outstanding by this point, so leave deliberately.
process.exit(0);
