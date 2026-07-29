// ─── The execution layer ─────────────────────────────────────────────────────
// Every one of these is a thing SYNC can actually do — not a suggestion it
// writes out for you to carry out yourself. Each tool:
//   · declares a schema the model plans against
//   · runs through `commit`, so it lands in the ledger with a working Undo
//   · returns a compact result for the model and a human line for the console
//
// Two rules the whole file obeys:
//   1. Never guess an identity. If "move the client call" matches two blocks,
//      say so and list them; a silently-wrong edit is worse than a question.
//   2. Never fail silently. A tool that can't do the thing returns ok:false
//      with a reason the model can act on in the same turn.

import { commit, getState } from "../data/store.js";
import { id } from "../lib/id.js";
import {
  dayKey, minsOfDay, parseTime, parseDay, fmtTime, fmtDur, dayLabel,
} from "../lib/time.js";
import { BLOCK_KINDS, PRIORITIES, PRIORITY_RANK } from "../data/seed.js";
import { SOURCE_KEYS, sourceCatalogue, sourceMeta } from "./pentagon-sources.js";

const KIND_KEYS = BLOCK_KINDS.map((k) => k.key);
const PRIORITY_KEYS = PRIORITIES.map((p) => p.key);

/* ── helpers ───────────────────────────────────────────────────────────────── */
const ok = (summary, result, detail) => ({ ok: true, summary, detail: detail || "", result: result ?? summary });
const fail = (reason, hint) => ({ ok: false, summary: reason, detail: hint || "", result: `FAILED: ${reason}${hint ? ` — ${hint}` : ""}` });

const norm = (s) => String(s || "").trim().toLowerCase();

/**
 * Find one item by id or by name. Returns {item} | {error} — never a guess.
 * Exact id wins; then exact title; then a unique substring match.
 */
function resolveOne(list, ref, { label = "item", titleKey = "title" } = {}) {
  if (!ref) return { error: `No ${label} named.` };
  const byId = list.find((x) => x.id === ref);
  if (byId) return { item: byId };

  const n = norm(ref);
  const exact = list.filter((x) => norm(x[titleKey]) === n);
  if (exact.length === 1) return { item: exact[0] };
  if (exact.length > 1) return { error: `"${ref}" matches ${exact.length} ${label}s. Use the id.`, candidates: exact };

  const partial = list.filter((x) => norm(x[titleKey]).includes(n) || n.includes(norm(x[titleKey])));
  if (partial.length === 1) return { item: partial[0] };
  if (partial.length > 1) {
    return {
      error: `"${ref}" is ambiguous — it matches: ${partial.map((x) => `${x[titleKey]} (${x.id})`).join(", ")}. Ask which one, or pass the id.`,
      candidates: partial,
    };
  }
  return { error: `No ${label} matching "${ref}".` };
}

/** Blocks that would overlap [start, start+mins) on a day, excluding one id. */
function collisions(day, start, mins, exceptId) {
  return getState().blocks.filter(
    (b) => b.day === day && b.id !== exceptId && b.status !== "cancelled" && start < b.start + b.mins && b.start < start + mins
  );
}

function normalizeBlockInput(raw, dayFallback) {
  const day = parseDay(raw.day, dayKey()) || dayFallback || dayKey();
  const start = parseTime(raw.start);
  if (start == null) return { error: `Couldn't read the start time "${raw.start}". Use 24h ("14:00") or 12h ("2pm").` };
  const mins = Math.max(5, Math.min(720, Math.round(Number(raw.mins) || 30)));
  const kind = KIND_KEYS.includes(raw.kind) ? raw.kind : "deep";
  const title = String(raw.title || "").trim();
  if (!title) return { error: "A block needs a title." };
  return { block: { id: id("b"), day, start, mins, kind, title, note: String(raw.note || "").trim(), venture: raw.venture || null, status: "planned" } };
}

const blockLine = (b) => `${fmtTime(b.start)}–${fmtTime(b.start + b.mins)} · ${b.title}`;

/* ══════════════════════════════════════════════════════════════════════════════
   THE TOOLS
   ══════════════════════════════════════════════════════════════════════════ */

export const TOOLS = {
  /* ── reading ─────────────────────────────────────────────────────────── */
  read_state: {
    verb: "Reading the day",
    readonly: true,
    description:
      "Read the current state of the user's day: the plan, open tasks, follow-ups, running focus session, and standing directives. Call this at the start of any turn where you need to know what is already happening before you change something. Cheap — prefer calling it over assuming.",
    input_schema: {
      type: "object",
      properties: {
        day: { type: "string", description: 'Which day to read. "today" (default), "tomorrow", or YYYY-MM-DD.' },
        include: {
          type: "array",
          items: { type: "string", enum: ["plan", "tasks", "followups", "notes", "memory", "decisions", "drafts", "briefs"] },
          description: "Which sections to include. Defaults to plan, tasks, followups and memory.",
        },
      },
    },
    run(input) {
      const s = getState();
      const day = parseDay(input.day, dayKey()) || dayKey();
      const want = new Set(input.include?.length ? input.include : ["plan", "tasks", "followups", "memory"]);
      const now = minsOfDay();
      const out = {
        now: { day: dayKey(), time: fmtTime(now), weekday: dayLabel(dayKey(), { long: true }) },
        viewing: day,
        focus: s.focus ? { label: s.focus.label, endsIn: fmtDur(Math.max(0, Math.round((s.focus.endsAt - Date.now()) / 60000))) } : null,
        directives: s.profile.directives,
      };
      if (want.has("plan")) {
        out.plan = s.blocks
          .filter((b) => b.day === day)
          .sort((a, b) => a.start - b.start)
          .map((b) => ({ id: b.id, time: `${fmtTime(b.start)}–${fmtTime(b.start + b.mins)}`, title: b.title, kind: b.kind, status: b.status }));
        out.freeAfterNow = day === dayKey()
          ? describeGaps(s, day, Math.max(now, s.profile.workStart), s.profile.workEnd)
          : describeGaps(s, day, s.profile.workStart, s.profile.workEnd);
      }
      if (want.has("tasks")) {
        out.tasks = s.tasks
          .filter((t) => t.status !== "done")
          .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2))
          .slice(0, 40)
          .map((t) => ({ id: t.id, title: t.title, priority: t.priority, venture: t.venture, due: t.due, estimate: t.estimate }));
      }
      if (want.has("followups")) {
        out.followups = s.followups
          .filter((f) => f.status === "open")
          .map((f) => ({ id: f.id, who: f.who, what: f.what, due: f.due, overdue: !!f.due && f.due < dayKey() }));
      }
      if (want.has("notes")) out.notes = s.notes.slice(-15).map((n) => ({ id: n.id, text: n.text, tags: n.tags }));
      if (want.has("memory")) out.memory = s.memory.map((m) => ({ id: m.id, fact: m.fact }));
      if (want.has("decisions")) out.decisions = s.decisions.slice(-12).map((d) => ({ id: d.id, decision: d.decision, rationale: d.rationale }));
      if (want.has("drafts")) out.drafts = s.drafts.slice(-10).map((d) => ({ id: d.id, kind: d.kind, title: d.title }));
      if (want.has("briefs")) out.briefs = s.briefs.slice(-3).map((b) => ({ id: b.id, kind: b.kind, day: b.day }));
      return ok("Read the day", JSON.stringify(out));
    },
  },

  search_memory: {
    verb: "Searching",
    readonly: true,
    description:
      "Full-text search across notes, tasks, follow-ups, decisions, drafts and durable memory. Use it before saying you don't know something about the user's own world.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "What to look for." } },
      required: ["query"],
    },
    run(input) {
      const s = getState();
      const q = norm(input.query);
      if (!q) return fail("Empty search.");
      const hit = (text) => norm(text).includes(q);
      const res = {
        memory: s.memory.filter((m) => hit(m.fact)).map((m) => ({ id: m.id, fact: m.fact })),
        notes: s.notes.filter((n) => hit(n.text) || (n.tags || []).some(hit)).slice(-25).map((n) => ({ id: n.id, text: n.text })),
        tasks: s.tasks.filter((t) => hit(t.title) || hit(t.note)).map((t) => ({ id: t.id, title: t.title, status: t.status })),
        followups: s.followups.filter((f) => hit(f.who) || hit(f.what)).map((f) => ({ id: f.id, who: f.who, what: f.what, status: f.status })),
        decisions: s.decisions.filter((d) => hit(d.decision) || hit(d.rationale)).map((d) => ({ id: d.id, decision: d.decision })),
        drafts: s.drafts.filter((d) => hit(d.title) || hit(d.body)).map((d) => ({ id: d.id, title: d.title })),
      };
      const n = Object.values(res).reduce((a, x) => a + x.length, 0);
      return ok(n ? `Found ${n} match${n === 1 ? "" : "es"}` : "Nothing matched", JSON.stringify(res), `"${input.query}"`);
    },
  },

  /* ── the day ─────────────────────────────────────────────────────────── */
  plan_day: {
    verb: "Laying out the day",
    description:
      "Lay out a whole day at once. This is the tool for 'plan my day', 'rebuild my afternoon', 'here's what today looks like'. Blocks must not overlap; order them and give each a realistic duration. Prefer 60–120 minute deep-work blocks, and leave gaps — a plan with no slack is a plan that breaks by 10am.",
    input_schema: {
      type: "object",
      properties: {
        day: { type: "string", description: '"today" (default), "tomorrow", or YYYY-MM-DD.' },
        replace: { type: "boolean", description: "true wipes the existing plan for that day first. Default false — new blocks are added alongside what's there." },
        blocks: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              start: { type: "string", description: 'Start time — "09:00" or "9am".' },
              mins: { type: "number", description: "Length in minutes." },
              kind: { type: "string", enum: KIND_KEYS },
              note: { type: "string", description: "What 'done' looks like for this block." },
              venture: { type: "string", description: "Which venture or area this belongs to." },
            },
            required: ["title", "start", "mins"],
          },
        },
      },
      required: ["blocks"],
    },
    run(input) {
      const day = parseDay(input.day, dayKey()) || dayKey();
      const parsed = [];
      for (const raw of input.blocks) {
        const r = normalizeBlockInput(raw, day);
        if (r.error) return fail(r.error);
        parsed.push({ ...r.block, day });
      }
      parsed.sort((a, b) => a.start - b.start);
      for (let i = 1; i < parsed.length; i++) {
        const prev = parsed[i - 1], cur = parsed[i];
        if (cur.start < prev.start + prev.mins) {
          return fail(
            `"${cur.title}" at ${fmtTime(cur.start)} overlaps "${prev.title}" (${fmtTime(prev.start)}–${fmtTime(prev.start + prev.mins)}).`,
            "Re-issue the plan with times that don't collide."
          );
        }
      }
      const replace = !!input.replace;
      commit({
        action: "plan_day",
        title: replace ? `Rebuilt ${dayLabel(day)}` : `Planned ${dayLabel(day)}`,
        detail: parsed.map(blockLine).join(" · "),
        touches: ["blocks"],
        apply: (s) => ({ blocks: [...(replace ? s.blocks.filter((b) => b.day !== day) : s.blocks), ...parsed] }),
      });
      return ok(
        `${replace ? "Rebuilt" : "Planned"} ${dayLabel(day)} — ${parsed.length} block${parsed.length === 1 ? "" : "s"}`,
        JSON.stringify({ day, blocks: parsed.map((b) => ({ id: b.id, time: fmtTime(b.start), title: b.title, mins: b.mins })) }),
        parsed.map(blockLine).join(" · ")
      );
    },
  },

  schedule_block: {
    verb: "Scheduling",
    description:
      "Put one block on the calendar. Use this for a single addition — a call, a work block, a break. If the slot is taken you get told what it collides with; decide whether to move the other thing or pick a different slot, and say which you did.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        start: { type: "string", description: '"14:00" or "2pm".' },
        mins: { type: "number", description: "Length in minutes. Default 30." },
        day: { type: "string", description: '"today" (default), "tomorrow", or YYYY-MM-DD.' },
        kind: { type: "string", enum: KIND_KEYS },
        note: { type: "string" },
        venture: { type: "string" },
        force: { type: "boolean", description: "Schedule even if it overlaps something. Only set this when the user has been told about the collision." },
      },
      required: ["title", "start"],
    },
    run(input) {
      const r = normalizeBlockInput(input, dayKey());
      if (r.error) return fail(r.error);
      const b = r.block;
      const hits = collisions(b.day, b.start, b.mins, null);
      if (hits.length && !input.force) {
        return fail(
          `${fmtTime(b.start)}–${fmtTime(b.start + b.mins)} collides with ${hits.map(blockLine).join(" and ")}.`,
          "Either move the existing block, pick another slot, or call again with force:true if the user wants them stacked."
        );
      }
      commit({
        action: "schedule_block",
        title: `Scheduled ${b.title}`,
        detail: `${dayLabel(b.day)} · ${blockLine(b)}`,
        touches: ["blocks"],
        apply: (s) => ({ blocks: [...s.blocks, b] }),
      });
      return ok(`Scheduled "${b.title}" ${dayLabel(b.day).toLowerCase()} at ${fmtTime(b.start)}`, JSON.stringify({ id: b.id, day: b.day, start: fmtTime(b.start), mins: b.mins }));
    },
  },

  move_block: {
    verb: "Moving",
    description:
      "Move or resize an existing block. Identify it by id (best) or by its title. Changing a block's day moves it to another date entirely.",
    input_schema: {
      type: "object",
      properties: {
        block: { type: "string", description: "Block id, or its title." },
        start: { type: "string", description: "New start time." },
        mins: { type: "number", description: "New length in minutes." },
        day: { type: "string", description: "New day." },
        title: { type: "string", description: "Rename it." },
        force: { type: "boolean", description: "Allow a resulting overlap." },
      },
      required: ["block"],
    },
    run(input) {
      const s = getState();
      const r = resolveOne(s.blocks, input.block, { label: "block" });
      if (r.error) return fail(r.error);
      const b = r.item;
      const day = input.day != null ? (parseDay(input.day, dayKey()) || b.day) : b.day;
      let start = b.start;
      if (input.start != null) {
        const t = parseTime(input.start);
        if (t == null) return fail(`Couldn't read the time "${input.start}".`);
        start = t;
      }
      const mins = input.mins != null ? Math.max(5, Math.min(720, Math.round(Number(input.mins)))) : b.mins;
      const title = input.title != null ? String(input.title).trim() || b.title : b.title;

      const hits = collisions(day, start, mins, b.id);
      if (hits.length && !input.force) {
        return fail(
          `That would put "${title}" on top of ${hits.map(blockLine).join(" and ")}.`,
          "Move the other block first, choose another slot, or pass force:true if stacking is intended."
        );
      }
      const next = { ...b, day, start, mins, title };
      commit({
        action: "move_block",
        title: `Moved ${b.title}`,
        detail: `${blockLine(b)} → ${dayLabel(day)} ${blockLine(next)}`,
        touches: ["blocks"],
        apply: (st) => ({ blocks: st.blocks.map((x) => (x.id === b.id ? next : x)) }),
      });
      return ok(`Moved "${title}" to ${dayLabel(day).toLowerCase()} ${fmtTime(start)}`, JSON.stringify({ id: b.id, day, start: fmtTime(start), mins }));
    },
  },

  cancel_block: {
    verb: "Clearing",
    description: "Take a block off the day entirely. Use complete_block instead when the thing actually happened.",
    input_schema: {
      type: "object",
      properties: { block: { type: "string", description: "Block id or title." } },
      required: ["block"],
    },
    run(input) {
      const s = getState();
      const r = resolveOne(s.blocks, input.block, { label: "block" });
      if (r.error) return fail(r.error);
      const b = r.item;
      commit({
        action: "cancel_block",
        title: `Cleared ${b.title}`,
        detail: `${dayLabel(b.day)} · ${blockLine(b)}`,
        touches: ["blocks"],
        apply: (st) => ({ blocks: st.blocks.filter((x) => x.id !== b.id) }),
      });
      return ok(`Cleared "${b.title}" from ${dayLabel(b.day).toLowerCase()}`, JSON.stringify({ freed: `${fmtTime(b.start)}–${fmtTime(b.start + b.mins)}` }));
    },
  },

  complete_block: {
    verb: "Closing out",
    description: "Mark a block as done. Optionally record what actually came out of it — that note is what the evening debrief is built from.",
    input_schema: {
      type: "object",
      properties: {
        block: { type: "string", description: "Block id or title." },
        outcome: { type: "string", description: "What actually happened or shipped." },
      },
      required: ["block"],
    },
    run(input) {
      const s = getState();
      const r = resolveOne(s.blocks, input.block, { label: "block" });
      if (r.error) return fail(r.error);
      const b = r.item;
      const next = { ...b, status: "done", outcome: String(input.outcome || "").trim(), doneAt: Date.now() };
      commit({
        action: "complete_block",
        title: `Done — ${b.title}`,
        detail: next.outcome || blockLine(b),
        touches: ["blocks"],
        apply: (st) => ({ blocks: st.blocks.map((x) => (x.id === b.id ? next : x)) }),
      });
      return ok(`Marked "${b.title}" done`, JSON.stringify({ id: b.id, status: "done" }));
    },
  },

  /* ── the queue ───────────────────────────────────────────────────────── */
  add_tasks: {
    verb: "Capturing",
    description:
      "Add one or more tasks. Built for capture at speed: when the user dumps five things in one breath, take all five in a single call rather than five calls. Set a priority honestly — if everything is 'now', nothing is.",
    input_schema: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              priority: { type: "string", enum: PRIORITY_KEYS, description: "Default normal." },
              venture: { type: "string", description: "Which venture or area it belongs to." },
              estimate: { type: "number", description: "Rough minutes of work." },
              due: { type: "string", description: '"today", "friday", "+3d", or YYYY-MM-DD.' },
              note: { type: "string" },
            },
            required: ["title"],
          },
        },
      },
      required: ["tasks"],
    },
    run(input) {
      const made = [];
      for (const raw of input.tasks) {
        const title = String(raw.title || "").trim();
        if (!title) continue;
        made.push({
          id: id("k"),
          title,
          priority: PRIORITY_KEYS.includes(raw.priority) ? raw.priority : "normal",
          venture: raw.venture || null,
          estimate: Number(raw.estimate) > 0 ? Math.round(Number(raw.estimate)) : null,
          due: raw.due ? parseDay(raw.due, dayKey()) : null,
          note: String(raw.note || "").trim(),
          status: "open",
          createdAt: Date.now(),
        });
      }
      if (!made.length) return fail("No task had a title.");
      commit({
        action: "add_tasks",
        title: made.length === 1 ? `Captured "${made[0].title}"` : `Captured ${made.length} tasks`,
        detail: made.map((t) => t.title).join(" · "),
        touches: ["tasks"],
        apply: (s) => ({ tasks: [...s.tasks, ...made] }),
      });
      return ok(
        made.length === 1 ? `Captured "${made[0].title}"` : `Captured ${made.length} tasks`,
        JSON.stringify(made.map((t) => ({ id: t.id, title: t.title, priority: t.priority })))
      );
    },
  },

  update_task: {
    verb: "Updating",
    description:
      "Change or close a task. Setting status to 'done' completes it; 'dropped' removes it from the queue without pretending it happened.",
    input_schema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Task id or title." },
        status: { type: "string", enum: ["open", "done", "dropped"] },
        title: { type: "string" },
        priority: { type: "string", enum: PRIORITY_KEYS },
        due: { type: "string" },
        estimate: { type: "number" },
        venture: { type: "string" },
        note: { type: "string" },
      },
      required: ["task"],
    },
    run(input) {
      const s = getState();
      const r = resolveOne(s.tasks, input.task, { label: "task" });
      if (r.error) return fail(r.error);
      const t = r.item;
      const patch = {};
      if (input.status) patch.status = input.status;
      if (input.status === "done") patch.doneAt = Date.now();
      if (input.title) patch.title = String(input.title).trim();
      if (input.priority) patch.priority = input.priority;
      if (input.due !== undefined) patch.due = input.due ? parseDay(input.due, dayKey()) : null;
      if (input.estimate != null) patch.estimate = Math.round(Number(input.estimate)) || null;
      if (input.venture !== undefined) patch.venture = input.venture || null;
      if (input.note !== undefined) patch.note = String(input.note || "").trim();
      if (!Object.keys(patch).length) return fail("Nothing to change on that task.");

      const next = { ...t, ...patch };
      commit({
        action: "update_task",
        title: patch.status === "done" ? `Done — ${t.title}` : `Updated ${t.title}`,
        detail: patch.status === "dropped" ? "Dropped" : Object.keys(patch).filter((k) => k !== "doneAt").join(", "),
        touches: ["tasks"],
        apply: (st) => ({ tasks: st.tasks.map((x) => (x.id === t.id ? next : x)) }),
      });
      return ok(patch.status === "done" ? `Closed "${t.title}"` : `Updated "${t.title}"`, JSON.stringify({ id: t.id, ...patch }));
    },
  },

  add_followup: {
    verb: "Tracking",
    description:
      "Track something you're waiting on from another person — a reply, an invoice, a decision. This is the list that stops things quietly dying.",
    input_schema: {
      type: "object",
      properties: {
        who: { type: "string", description: "The person or company." },
        what: { type: "string", description: "What you're waiting on." },
        due: { type: "string", description: "When to chase — a day reference." },
        channel: { type: "string", description: "email, call, Slack, DM…" },
      },
      required: ["who", "what"],
    },
    run(input) {
      const f = {
        id: id("f"),
        who: String(input.who).trim(),
        what: String(input.what).trim(),
        due: input.due ? parseDay(input.due, dayKey()) : null,
        channel: String(input.channel || "").trim(),
        status: "open",
        createdAt: Date.now(),
      };
      commit({
        action: "add_followup",
        title: `Waiting on ${f.who}`,
        detail: f.what + (f.due ? ` · chase ${dayLabel(f.due)}` : ""),
        touches: ["followups"],
        apply: (s) => ({ followups: [...s.followups, f] }),
      });
      return ok(`Tracking: ${f.who} — ${f.what}`, JSON.stringify({ id: f.id, due: f.due }));
    },
  },

  resolve_followup: {
    verb: "Closing",
    description: "Close a follow-up because it came back, or because it no longer matters.",
    input_schema: {
      type: "object",
      properties: {
        followup: { type: "string", description: "Follow-up id, or the person's name." },
        outcome: { type: "string", description: "What came back." },
      },
      required: ["followup"],
    },
    run(input) {
      const s = getState();
      const open = s.followups.filter((f) => f.status === "open");
      const r = resolveOne(open, input.followup, { label: "follow-up", titleKey: "who" });
      if (r.error) return fail(r.error);
      const f = r.item;
      const next = { ...f, status: "closed", outcome: String(input.outcome || "").trim(), closedAt: Date.now() };
      commit({
        action: "resolve_followup",
        title: `Closed — ${f.who}`,
        detail: next.outcome || f.what,
        touches: ["followups"],
        apply: (st) => ({ followups: st.followups.map((x) => (x.id === f.id ? next : x)) }),
      });
      return ok(`Closed the ${f.who} follow-up`, JSON.stringify({ id: f.id }));
    },
  },

  /* ── knowledge ───────────────────────────────────────────────────────── */
  capture_note: {
    verb: "Noting",
    description:
      "Write down something said in passing that matters later but isn't a task — an idea, a number, a thing someone said. Verbatim beats paraphrase.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["text"],
    },
    run(input) {
      const n = { id: id("n"), text: String(input.text).trim(), tags: (input.tags || []).map((t) => String(t).trim()).filter(Boolean), createdAt: Date.now() };
      if (!n.text) return fail("Empty note.");
      commit({
        action: "capture_note",
        title: "Noted",
        detail: n.text.length > 120 ? n.text.slice(0, 117) + "…" : n.text,
        touches: ["notes"],
        apply: (s) => ({ notes: [...s.notes, n] }),
      });
      return ok("Noted", JSON.stringify({ id: n.id }));
    },
  },

  remember: {
    verb: "Committing to memory",
    description:
      "Store a durable fact about the user's world — a person, a constraint, a preference, a number that stays true. Everything stored here is loaded into your context on every future turn, so keep each fact short, true, and worth carrying. Don't store today's schedule here.",
    input_schema: {
      type: "object",
      properties: { fact: { type: "string", description: "One sentence, stated as fact." } },
      required: ["fact"],
    },
    run(input) {
      const fact = String(input.fact || "").trim();
      if (!fact) return fail("Empty fact.");
      const s = getState();
      if (s.memory.some((m) => norm(m.fact) === norm(fact))) return ok("Already remembered", JSON.stringify({ duplicate: true }));
      const m = { id: id("m"), fact, createdAt: Date.now() };
      commit({
        action: "remember",
        title: "Remembered",
        detail: fact,
        touches: ["memory"],
        apply: (st) => ({ memory: [...st.memory, m] }),
      });
      return ok("Remembered", JSON.stringify({ id: m.id }));
    },
  },

  forget: {
    verb: "Forgetting",
    description: "Drop a durable fact that is no longer true. Prefer replacing a stale fact over stacking a contradiction next to it.",
    input_schema: {
      type: "object",
      properties: { memory: { type: "string", description: "Memory id, or enough of the fact to identify it." } },
      required: ["memory"],
    },
    run(input) {
      const s = getState();
      const r = resolveOne(s.memory, input.memory, { label: "memory", titleKey: "fact" });
      if (r.error) return fail(r.error);
      const m = r.item;
      commit({
        action: "forget",
        title: "Forgot",
        detail: m.fact,
        touches: ["memory"],
        apply: (st) => ({ memory: st.memory.filter((x) => x.id !== m.id) }),
      });
      return ok("Forgotten", JSON.stringify({ id: m.id }));
    },
  },

  log_decision: {
    verb: "Logging the call",
    description:
      "Record a decision and why it was made. Use it whenever the user commits to something with consequences — so the reasoning is there in six weeks when the outcome lands.",
    input_schema: {
      type: "object",
      properties: {
        decision: { type: "string" },
        rationale: { type: "string", description: "Why — including what was traded away." },
        revisit: { type: "string", description: "When this should be re-examined." },
      },
      required: ["decision"],
    },
    run(input) {
      const d = {
        id: id("d"),
        decision: String(input.decision).trim(),
        rationale: String(input.rationale || "").trim(),
        revisit: input.revisit ? parseDay(input.revisit, dayKey()) : null,
        createdAt: Date.now(),
      };
      if (!d.decision) return fail("Empty decision.");
      commit({
        action: "log_decision",
        title: "Decision logged",
        detail: d.decision,
        touches: ["decisions"],
        apply: (s) => ({ decisions: [...s.decisions, d] }),
      });
      return ok("Logged", JSON.stringify({ id: d.id }));
    },
  },

  save_draft: {
    verb: "Drafting",
    description:
      "Save a piece of writing the user can copy and send — an email, an outreach message, ad copy, a post, a spec. Write the finished thing, not a description of it. Never invent a fact about a person or a number; leave a clearly-marked blank instead.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "How the user will recognise it in the list." },
        body: { type: "string", description: "The full text, ready to send." },
        kind: { type: "string", enum: ["email", "message", "copy", "post", "doc", "script"] },
      },
      required: ["title", "body"],
    },
    run(input) {
      const d = {
        id: id("r"),
        title: String(input.title).trim(),
        body: String(input.body),
        kind: input.kind || "doc",
        createdAt: Date.now(),
      };
      if (!d.title || !d.body.trim()) return fail("A draft needs a title and a body.");
      commit({
        action: "save_draft",
        title: `Drafted "${d.title}"`,
        detail: `${d.body.trim().split(/\s+/).length} words · ${d.kind}`,
        touches: ["drafts"],
        apply: (s) => ({ drafts: [...s.drafts, d] }),
      });
      return ok(`Drafted "${d.title}"`, JSON.stringify({ id: d.id, words: d.body.trim().split(/\s+/).length }));
    },
  },

  write_brief: {
    verb: "Writing the brief",
    description:
      "File the morning brief or the evening debrief. Write it as you'd say it out loud: what matters, in what order, and what you'd do first. No headers-and-bullets template unless the user asks for one.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["morning", "evening"] },
        body: { type: "string" },
        headline: { type: "string", description: "One line — the single thing that matters most." },
      },
      required: ["kind", "body"],
    },
    run(input) {
      const b = {
        id: id("br"),
        kind: input.kind,
        day: dayKey(),
        headline: String(input.headline || "").trim(),
        body: String(input.body),
        createdAt: Date.now(),
      };
      commit({
        action: "write_brief",
        title: b.kind === "morning" ? "Morning brief filed" : "Debrief filed",
        detail: b.headline || `${b.body.trim().split(/\s+/).length} words`,
        touches: [],
        apply: (s) => ({ briefs: [...s.briefs.filter((x) => !(x.day === b.day && x.kind === b.kind)), b] }),
      });
      return ok(`Filed the ${b.kind} brief`, JSON.stringify({ id: b.id }));
    },
  },

  /* ── focus ───────────────────────────────────────────────────────────── */
  start_focus: {
    verb: "Starting the clock",
    description:
      "Start a focus session — a running clock on one thing. Use it when the user says they're starting work, not just when they say 'start a timer'. Only one can run at a time.",
    input_schema: {
      type: "object",
      properties: {
        label: { type: "string", description: "What they're working on." },
        mins: { type: "number", description: "Length in minutes. Default 50." },
        block: { type: "string", description: "The block id this session belongs to, if there is one." },
      },
      required: ["label"],
    },
    run(input) {
      const s = getState();
      if (s.focus) return fail(`A focus session is already running: "${s.focus.label}".`, "End it first with end_focus if the user has moved on.");
      const mins = Math.max(1, Math.min(240, Math.round(Number(input.mins) || 50)));
      const f = { id: id("s"), label: String(input.label).trim(), mins, startedAt: Date.now(), endsAt: Date.now() + mins * 60000, blockId: input.block || null };
      commit({
        action: "start_focus",
        title: `Focus started — ${f.label}`,
        detail: `${fmtDur(mins)}, ends ${fmtTime(minsOfDay(f.endsAt))}`,
        touches: ["focus"],
        apply: () => ({ focus: f }),
      });
      return ok(`Focus running: ${f.label}, ${fmtDur(mins)}`, JSON.stringify({ endsAt: fmtTime(minsOfDay(f.endsAt)) }));
    },
  },

  end_focus: {
    verb: "Stopping the clock",
    description: "End the running focus session and optionally record what came out of it.",
    input_schema: {
      type: "object",
      properties: { outcome: { type: "string", description: "What got done." } },
    },
    run(input) {
      const s = getState();
      if (!s.focus) return fail("No focus session is running.");
      const f = s.focus;
      const ran = Math.round((Date.now() - f.startedAt) / 60000);
      const note = String(input.outcome || "").trim();
      commit({
        action: "end_focus",
        title: `Focus ended — ${f.label}`,
        detail: `${fmtDur(ran)}${note ? ` · ${note}` : ""}`,
        touches: ["focus", "notes"],
        apply: (st) => ({
          focus: null,
          notes: note ? [...st.notes, { id: id("n"), text: `[${f.label}] ${note}`, tags: ["focus"], createdAt: Date.now() }] : st.notes,
        }),
      });
      return ok(`Focus ended after ${fmtDur(ran)}`, JSON.stringify({ ran }));
    },
  },

  /* ── the user's own shape ────────────────────────────────────────────── */
  update_profile: {
    verb: "Updating your profile",
    description:
      "Change what SYNC knows structurally about the user: their name, what they do, their working hours, the ventures they run, and the standing directives you must follow every turn. Directives are rules about how you behave — add one when the user tells you how they want you to work.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        role: { type: "string" },
        workStart: { type: "string", description: 'Start of the working day, e.g. "08:00".' },
        workEnd: { type: "string", description: 'End of the working day, e.g. "18:00".' },
        addVenture: { type: "object", properties: { name: { type: "string" }, note: { type: "string" } }, required: ["name"] },
        addDirective: { type: "string", description: "A standing rule for how you should behave." },
        removeDirective: { type: "string", description: "The directive text to drop." },
      },
    },
    run(input) {
      const s = getState();
      const p = { ...s.profile };
      const changed = [];
      if (input.name) { p.name = String(input.name).trim(); changed.push("name"); }
      if (input.role) { p.role = String(input.role).trim(); changed.push("role"); }
      if (input.workStart) {
        const t = parseTime(input.workStart);
        if (t == null) return fail(`Couldn't read "${input.workStart}" as a time.`);
        p.workStart = t; changed.push("work start");
      }
      if (input.workEnd) {
        const t = parseTime(input.workEnd);
        if (t == null) return fail(`Couldn't read "${input.workEnd}" as a time.`);
        p.workEnd = t; changed.push("work end");
      }
      if (input.addVenture?.name) {
        const tones = ["var(--accent)", "var(--green)", "var(--amber)", "var(--purple)", "var(--pink)"];
        p.ventures = [...p.ventures, { key: id("v"), name: String(input.addVenture.name).trim(), note: String(input.addVenture.note || "").trim(), tone: tones[p.ventures.length % tones.length] }];
        changed.push(`venture "${input.addVenture.name}"`);
      }
      if (input.addDirective) {
        const d = String(input.addDirective).trim();
        if (d && !p.directives.some((x) => norm(x) === norm(d))) { p.directives = [...p.directives, d]; changed.push("directive"); }
      }
      if (input.removeDirective) {
        const before = p.directives.length;
        p.directives = p.directives.filter((x) => norm(x) !== norm(input.removeDirective) && !norm(x).includes(norm(input.removeDirective)));
        if (p.directives.length < before) changed.push("removed a directive");
      }
      if (!changed.length) return fail("Nothing to change.");
      commit({
        action: "update_profile",
        title: "Profile updated",
        detail: changed.join(", "),
        touches: ["profile"],
        apply: () => ({ profile: p }),
      });
      return ok(`Updated ${changed.join(", ")}`, JSON.stringify({ changed }));
    },
  },

  /* ── the Pentagon ────────────────────────────────────────────────────── */
  // Everything above this line is SYNC's own state, held in this browser. These
  // three reach the shared Supabase project the rest of the businesses run on.
  // The connector is imported lazily so a signed-out session never pays for it.
  pentagon_read: {
    verb: "Reading the Pentagon",
    readonly: true,
    description:
      `Read live data from the Pentagon — the shared database behind the user's real calendar, notes and businesses. This is current data, not SYNC's own state. Read it rather than guessing, and never answer from memory when a source here would know.\n\nSources:\n${sourceCatalogue()}\n\nTwo things worth knowing: "calendar" is the real calendar and is separate from SYNC's day plan, so check both before calling a day clear; and for any "how's business" question start with "pipeline", then drill in.`,
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", enum: SOURCE_KEYS, description: "Which source to read." },
        day: { type: "string", description: 'For "calendar": which day — "today" (default), "tomorrow", or YYYY-MM-DD. For "store": the first day of a range.' },
        to: { type: "string", description: "End of the range, inclusive. Same formats as day." },
        limit: { type: "integer", description: "How many rows, 1–200. Default 25." },
      },
      required: ["source"],
    },
    async run(input) {
      const { read } = await import("./pentagon.js");
      const source = String(input.source || "");
      const day = input.day ? parseDay(input.day, null) || input.day : undefined;
      const to = input.to ? parseDay(input.to, null) || input.to : undefined;
      const res = await read(source, { day, to, limit: input.limit });
      if (!res.ok) return fail(res.error);
      return ok(res.summary, JSON.stringify(res.data), sourceMeta(source)?.label || source);
    },
  },

  pentagon_add_event: {
    verb: "Adding to the calendar",
    description:
      "Put a real event on the user's actual calendar — the shared one their other apps show. Use this when they say to put something in or on the calendar. For shaping the working day inside SYNC use schedule_block instead: that is the plan, this is the calendar.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "What the event is." },
        day: { type: "string", description: '"today", "tomorrow" or YYYY-MM-DD. Defaults to today.' },
        start: { type: "string", description: 'Start time, "14:00" or "2pm". Omit for an all-day event.' },
        mins: { type: "integer", description: "How long, in minutes. Default 60." },
        allDay: { type: "boolean", description: "True for an all-day event." },
        location: { type: "string" },
        notes: { type: "string" },
      },
      required: ["title"],
    },
    async run(input) {
      const { addEvent } = await import("./pentagon.js");
      const day = parseDay(input.day, dayKey()) || dayKey();
      const allDay = !!input.allDay || !input.start;
      let startISO;
      let endISO = null;
      let when;

      if (allDay) {
        startISO = new Date(`${day}T00:00:00`).toISOString();
        when = `${dayLabel(day)}, all day`;
      } else {
        const start = parseTime(input.start);
        if (start == null) return fail(`Couldn't read the start time "${input.start}".`, 'Use 24h ("14:00") or 12h ("2pm").');
        const mins = Math.max(5, Math.min(720, Math.round(Number(input.mins) || 60)));
        const d = new Date(`${day}T00:00:00`);
        d.setMinutes(start);
        startISO = d.toISOString();
        endISO = new Date(d.getTime() + mins * 60000).toISOString();
        when = `${dayLabel(day)} at ${fmtTime(start)}`;
      }

      const res = await addEvent({
        title: input.title,
        startISO,
        endISO,
        allDay,
        location: input.location || null,
        notes: input.notes || "",
      });
      if (!res.ok) return fail(res.error);

      // Nothing local changed, so there is no before-image — but the entry still
      // carries `remote`, and that is what makes Undo delete the row upstream.
      commit({
        action: "pentagon_add_event",
        title: `Calendar · ${String(input.title).trim()}`,
        detail: when,
        touches: [],
        remote: res.remote,
        apply: () => ({}),
      });
      return ok(`On the calendar — ${when}`, JSON.stringify({ id: res.data.id, when }));
    },
  },

  pentagon_capture: {
    verb: "Saving to the Pentagon",
    description:
      "Write a note or a grocery item into the shared Pentagon lists, where the user's other apps can see it. Something only SYNC needs should use capture_note instead — this one is for what belongs to the household or the wider system.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["note", "grocery"], description: "What to write." },
        title: { type: "string", description: "For a note: its title." },
        body: { type: "string", description: "For a note: the body. For a grocery item: the item itself." },
      },
      required: ["kind", "body"],
    },
    async run(input) {
      const p = await import("./pentagon.js");
      const kind = input.kind === "grocery" ? "grocery" : "note";
      const body = String(input.body || "").trim();
      const res = kind === "grocery"
        ? await p.addGrocery(body)
        : await p.addNote({ title: input.title || "", body });
      if (!res.ok) return fail(res.error);

      commit({
        action: "pentagon_capture",
        title: kind === "grocery" ? `Groceries · ${body}` : `Note · ${String(input.title || body).slice(0, 40)}`,
        detail: kind === "grocery" ? "Added to the shared list" : "Saved to Board Room notes",
        touches: [],
        remote: res.remote,
        apply: () => ({}),
      });
      return ok(kind === "grocery" ? `Added ${body} to the list` : "Note saved", JSON.stringify({ id: res.data.id }));
    },
  },
};

/* ── gap analysis, shared by read_state and the Day page ───────────────────── */
export function describeGaps(s, day, from, to) {
  const blocks = s.blocks.filter((b) => b.day === day && b.status !== "cancelled").sort((a, b) => a.start - b.start);
  const gaps = [];
  let cursor = from;
  for (const b of blocks) {
    if (b.start + b.mins <= cursor) continue;
    if (b.start > cursor) gaps.push({ start: cursor, mins: Math.min(b.start, to) - cursor });
    cursor = Math.max(cursor, b.start + b.mins);
    if (cursor >= to) break;
  }
  if (cursor < to) gaps.push({ start: cursor, mins: to - cursor });
  return gaps
    .filter((g) => g.mins >= 15)
    .map((g) => ({ from: fmtTime(g.start), to: fmtTime(g.start + g.mins), mins: g.mins }));
}

/* ── what the model sees ───────────────────────────────────────────────────── */
export function toolDefs({ webSearch = true } = {}) {
  const defs = Object.entries(TOOLS).map(([name, t]) => ({
    name,
    description: t.description,
    input_schema: t.input_schema,
  }));
  if (webSearch) {
    // A server-side tool: Anthropic runs the search and hands back results with
    // citations. Nothing to execute on this end.
    defs.push({ type: "web_search_20250305", name: "web_search", max_uses: 6 });
  }
  return defs;
}

export const isServerTool = (name) => name === "web_search";

/** Tools that only look. The console badges these differently and never offers Undo. */
export const isReadonlyTool = (name) => !!TOOLS[name]?.readonly;

/**
 * Run a client tool by name. Never throws — a thrown tool is a failed tool.
 *
 * Deliberately not declared `async`. Every local tool touches nothing but the
 * store and returns its result there and then; only the Pentagon three cross a
 * network. Wrapping the whole registry in a promise to accommodate three of
 * them would make every caller — and every test — wait on a microtask for an
 * answer it already has. So: a synchronous tool comes back synchronously, an
 * async one comes back as a promise with the same failure shape, and callers
 * that might get either simply `await` it.
 */
export function runTool(name, input) {
  const t = TOOLS[name];
  if (!t) return fail(`There is no tool called "${name}".`);
  const blew = (e) => fail(`${name} threw: ${e?.message || e}`, "Don't retry it the same way.");
  try {
    const out = t.run(input || {});
    return out && typeof out.then === "function" ? out.then((r) => r, blew) : out;
  } catch (e) {
    return blew(e);
  }
}

export const toolVerb = (name) => TOOLS[name]?.verb || (name === "web_search" ? "Searching the web" : "Working");
