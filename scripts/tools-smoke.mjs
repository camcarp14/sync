// The execution layer is where a wrong answer becomes a wrong *day*: a
// double-booked hour, a task closed that wasn't the one meant. These tests are
// mostly about the two rules the tools promise — never guess an identity, and
// never fail silently.

import { installBrowserEnv, check, eq, report } from "./_env.mjs";
installBrowserEnv();

const store = await import("../src/data/store.js");
const { runTool, TOOLS, toolDefs, describeGaps, isServerTool } = await import("../src/agent/tools.js");
const { dayKey, addDays, fmtTime } = await import("../src/lib/time.js");

const today = dayKey();
const reset = () => store.resetAll({ keepKey: false });

/* ── the schemas the model plans against ───────────────────────────────────── */
const defs = toolDefs({ webSearch: true });
check("every tool is exposed", defs.length === Object.keys(TOOLS).length + 1);
check("web search is a server tool", defs.some((d) => d.type === "web_search_20250305"));
check("web search can be turned off", !toolDefs({ webSearch: false }).some((d) => d.name === "web_search"));
check("isServerTool recognises web_search", isServerTool("web_search") && !isServerTool("add_tasks"));
for (const d of defs) {
  if (d.type) continue;
  check(`${d.name} has a description`, typeof d.description === "string" && d.description.length > 40);
  check(`${d.name} has an object schema`, d.input_schema?.type === "object");
}

/* ── an unknown tool fails cleanly instead of throwing ─────────────────────── */
const bogus = runTool("teleport", {});
eq("unknown tool does not succeed", bogus.ok, false);
check("unknown tool explains itself", /no tool called/i.test(bogus.summary));

/* ── plan_day ──────────────────────────────────────────────────────────────── */
reset();
const planned = runTool("plan_day", {
  day: "today",
  blocks: [
    { title: "Deep work", start: "09:00", mins: 90, kind: "deep" },
    { title: "Standup", start: "11:00", mins: 30, kind: "meeting" },
  ],
});
eq("plan_day succeeded", planned.ok, true);
eq("plan_day created both blocks", store.getState().blocks.length, 2);
eq("plan_day is undoable", !!store.getState().ledger.at(-1).undo, true);

// Overlapping blocks inside one plan are refused with the pair named, so the
// model can fix it in the same turn instead of quietly stacking them.
const overlapping = runTool("plan_day", {
  blocks: [
    { title: "A", start: "13:00", mins: 60 },
    { title: "B", start: "13:30", mins: 60 },
  ],
});
eq("overlapping plan is refused", overlapping.ok, false);
check("refusal names both blocks", overlapping.summary.includes("A") && overlapping.summary.includes("B"));
eq("refused plan changed nothing", store.getState().blocks.length, 2);

// replace:true wipes only that day.
runTool("schedule_block", { title: "Tomorrow thing", start: "09:00", day: "tomorrow" });
runTool("plan_day", { replace: true, blocks: [{ title: "Only thing", start: "10:00", mins: 60 }] });
eq("replace cleared today", store.getState().blocks.filter((b) => b.day === today).length, 1);
eq("replace left other days alone", store.getState().blocks.filter((b) => b.day === addDays(today, 1)).length, 1);

/* ── schedule_block and collisions ─────────────────────────────────────────── */
reset();
runTool("schedule_block", { title: "Client call", start: "2pm", mins: 60, kind: "meeting" });
eq("12-hour time parsed", store.getState().blocks[0].start, 840);

const collided = runTool("schedule_block", { title: "Overlap", start: "14:30", mins: 30 });
eq("collision is refused", collided.ok, false);
check("collision names what it hit", collided.summary.includes("Client call"));
eq("refusal did not schedule", store.getState().blocks.length, 1);

const forced = runTool("schedule_block", { title: "Overlap", start: "14:30", mins: 30, force: true });
eq("force overrides the collision", forced.ok, true);
eq("forced block was created", store.getState().blocks.length, 2);

const badTime = runTool("schedule_block", { title: "Whenever", start: "sometime after lunch" });
eq("unreadable time is refused", badTime.ok, false);
check("unreadable time says what it wanted", /24h|12h/.test(badTime.summary));

const noTitle = runTool("schedule_block", { title: "  ", start: "09:00" });
eq("a block needs a title", noTitle.ok, false);

/* ── move_block: never guess ───────────────────────────────────────────────── */
reset();
runTool("schedule_block", { title: "Clarify outreach", start: "09:00", mins: 60 });
runTool("schedule_block", { title: "Clarify review", start: "11:00", mins: 60 });

const ambiguous = runTool("move_block", { block: "Clarify", start: "15:00" });
eq("an ambiguous reference is refused", ambiguous.ok, false);
check("refusal lists the candidates", ambiguous.summary.includes("Clarify outreach") && ambiguous.summary.includes("Clarify review"));

const missing = runTool("move_block", { block: "Nonexistent thing", start: "15:00" });
eq("an unknown reference is refused", missing.ok, false);

const exact = runTool("move_block", { block: "Clarify review", start: "15:00" });
eq("an exact title resolves", exact.ok, true);
eq("the right block moved", store.getState().blocks.find((b) => b.title === "Clarify review").start, 900);
eq("the other block did not move", store.getState().blocks.find((b) => b.title === "Clarify outreach").start, 540);

const byId = runTool("move_block", { block: store.getState().blocks[0].id, mins: 30 });
eq("an id resolves", byId.ok, true);
eq("resize applied", store.getState().blocks[0].mins, 30);

const moveCollide = runTool("move_block", { block: "Clarify review", start: "09:00" });
eq("a move into a collision is refused", moveCollide.ok, false);

const moveDay = runTool("move_block", { block: "Clarify review", day: "tomorrow" });
eq("a cross-day move works", moveDay.ok, true);
eq("the block changed day", store.getState().blocks.find((b) => b.title === "Clarify review").day, addDays(today, 1));

/* ── tasks ─────────────────────────────────────────────────────────────────── */
reset();
const captured = runTool("add_tasks", {
  tasks: [
    { title: "Send proposal", priority: "now", due: "today" },
    { title: "Reply to supplier", venture: "ZTS" },
    { title: "  " },
  ],
});
eq("bulk capture succeeded", captured.ok, true);
eq("empty titles are dropped", store.getState().tasks.length, 2);
eq("priority survived", store.getState().tasks[0].priority, "now");
eq("due date was parsed", store.getState().tasks[0].due, today);
eq("unspecified priority defaults", store.getState().tasks[1].priority, "normal");

const noTasks = runTool("add_tasks", { tasks: [{ title: "" }] });
eq("a capture with nothing usable is refused", noTasks.ok, false);

const closed = runTool("update_task", { task: "Send proposal", status: "done" });
eq("closing a task by title works", closed.ok, true);
eq("status changed", store.getState().tasks.find((t) => t.title === "Send proposal").status, "done");
check("doneAt was stamped", !!store.getState().tasks.find((t) => t.title === "Send proposal").doneAt);

const nothingToDo = runTool("update_task", { task: "Reply to supplier" });
eq("an update with no fields is refused", nothingToDo.ok, false);

/* ── follow-ups ────────────────────────────────────────────────────────────── */
reset();
runTool("add_followup", { who: "Northside Dental", what: "Signed proposal", due: "+2d" });
eq("follow-up created", store.getState().followups.length, 1);
eq("chase date parsed", store.getState().followups[0].due, addDays(today, 2));

const resolved = runTool("resolve_followup", { followup: "Northside", outcome: "Signed" });
eq("resolving by partial name works", resolved.ok, true);
eq("follow-up closed", store.getState().followups[0].status, "closed");
eq("resolving a closed follow-up is refused", runTool("resolve_followup", { followup: "Northside" }).ok, false);

/* ── memory ────────────────────────────────────────────────────────────────── */
reset();
runTool("remember", { fact: "The Northside retainer renews quarterly." });
eq("fact stored", store.getState().memory.length, 1);
const dup = runTool("remember", { fact: "the northside retainer renews quarterly." });
eq("a duplicate fact is accepted without duplicating", dup.ok, true);
eq("memory did not grow", store.getState().memory.length, 1);
eq("forgetting by partial text works", runTool("forget", { memory: "Northside retainer" }).ok, true);
eq("memory emptied", store.getState().memory.length, 0);
eq("forgetting something absent is refused", runTool("forget", { memory: "anything" }).ok, false);

/* ── focus: one at a time ──────────────────────────────────────────────────── */
reset();
eq("focus starts", runTool("start_focus", { label: "Proposal", mins: 50 }).ok, true);
check("focus is running", !!store.getState().focus);
const second = runTool("start_focus", { label: "Something else" });
eq("a second focus session is refused", second.ok, false);
check("refusal names the running session", second.summary.includes("Proposal"));
eq("ending focus works", runTool("end_focus", { outcome: "Sent it" }).ok, true);
eq("focus cleared", store.getState().focus, null);
eq("the outcome became a note", store.getState().notes.length, 1);
eq("ending when nothing runs is refused", runTool("end_focus", {}).ok, false);

/* ── profile and directives ────────────────────────────────────────────────── */
reset();
const prof = runTool("update_profile", { name: "Cameron", workStart: "07:30", addDirective: "Never book before 8am." });
eq("profile update succeeded", prof.ok, true);
eq("name set", store.getState().profile.name, "Cameron");
eq("work start parsed", store.getState().profile.workStart, 450);
eq("directive stored", store.getState().profile.directives.length, 1);
runTool("update_profile", { addDirective: "never book before 8am." });
eq("a duplicate directive is not stored twice", store.getState().profile.directives.length, 1);
eq("removing a directive works", runTool("update_profile", { removeDirective: "Never book" }).ok, true);
eq("directive removed", store.getState().profile.directives.length, 0);
eq("an empty profile update is refused", runTool("update_profile", {}).ok, false);
eq("an unreadable work time is refused", runTool("update_profile", { workEnd: "evening" }).ok, false);

/* ── read_state returns parseable JSON ─────────────────────────────────────── */
reset();
runTool("plan_day", { blocks: [{ title: "Deep work", start: "09:00", mins: 120 }] });
runTool("add_tasks", { tasks: [{ title: "A thing" }] });
const read = runTool("read_state", { include: ["plan", "tasks", "followups", "memory"] });
eq("read_state succeeded", read.ok, true);
const parsed = JSON.parse(read.result);
eq("read_state reports the plan", parsed.plan.length, 1);
eq("read_state reports open tasks", parsed.tasks.length, 1);
check("read_state states the current time", typeof parsed.now.time === "string");
eq("read_state does not touch the ledger", store.getState().ledger.filter((e) => e.action === "read_state").length, 0);

/* ── search ────────────────────────────────────────────────────────────────── */
runTool("capture_note", { text: "Supplier quoted 14 dollars a unit at 500." });
const found = JSON.parse(runTool("search_memory", { query: "supplier" }).result);
eq("search finds the note", found.notes.length, 1);
const nothing = JSON.parse(runTool("search_memory", { query: "zzzzz" }).result);
eq("search reports no matches honestly", nothing.notes.length + nothing.tasks.length, 0);
eq("an empty search is refused", runTool("search_memory", { query: "  " }).ok, false);

/* ── gap analysis ──────────────────────────────────────────────────────────── */
store.set({
  blocks: [
    { id: "g1", day: today, start: 540, mins: 60, title: "A", status: "planned" },
    { id: "g2", day: today, start: 720, mins: 60, title: "B", status: "planned" },
  ],
});
const gaps = describeGaps(store.getState(), today, 480, 1080);
eq("three gaps around two blocks", gaps.length, 3);
eq("first gap starts at the day start", gaps[0].from, fmtTime(480));
eq("first gap is an hour", gaps[0].mins, 60);
eq("middle gap spans the lunch hole", gaps[1].mins, 120);
eq("last gap runs to the day end", gaps[2].mins, 300);

// Back-to-back blocks leave no gap between them.
store.set({
  blocks: [
    { id: "h1", day: today, start: 540, mins: 60, title: "A", status: "planned" },
    { id: "h2", day: today, start: 600, mins: 60, title: "B", status: "planned" },
  ],
});
const tight = describeGaps(store.getState(), today, 540, 660);
eq("no gap between touching blocks", tight.length, 0);

// A cancelled block doesn't hold time.
store.set({ blocks: [{ id: "c1", day: today, start: 540, mins: 60, title: "A", status: "cancelled" }] });
eq("cancelled blocks free their time", describeGaps(store.getState(), today, 540, 600).length, 1);

report("tools");
