// ─── Reaching into the Pentagon ──────────────────────────────────────────────
// The IO half of the connector. Two different paths, on purpose:
//
//   personal → straight at boardroom.* over PostgREST. Those tables are keyed on
//              auth.uid(), so row-level security already scopes them to the
//              signed-in person, and SYNC can write as well as read.
//
//   business → through the sync.pentagon() function. Those tables are org-wide
//              with `authenticated`-role policies, meaning any signed-in account
//              could read them. SYNC refuses to lean on that: the function
//              checks ownership first, so a stranger holding the public key
//              gets nothing. Read-only.

import { supabase } from "../lib/supabase.js";
import { getCloud } from "../data/cloud.js";
import { readableError } from "../lib/supabase.js";
import { isPersonal, sourceMeta, daysUntilBirthday, summarise } from "./pentagon-sources.js";
import { dayKey } from "../lib/time.js";

const boardroom = () => supabase.schema("boardroom");

const fail = (error) => ({ ok: false, error });

/** Everything here needs a session; say which thing is missing, not "error". */
function guard(source) {
  if (!supabase) return "The Pentagon isn't configured in this build.";
  const c = getCloud();
  if (!c.user) return "Not connected to the Pentagon — sign in under Settings.";
  if (!isPersonal(source) && !c.owner) return "This account can't see the business data.";
  return null;
}

/** Local midnight bounds for an inclusive YYYY-MM-DD range. */
function bounds(from, to) {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to || from}T00:00:00`);
  b.setDate(b.getDate() + 1);
  return { fromISO: a.toISOString(), toISO: b.toISOString() };
}

const todayKey = () => dayKey();

/* ── reads ─────────────────────────────────────────────────────────────────── */
export async function read(source, { day, to, limit = 25, includeChecked = false } = {}) {
  const blocked = guard(source);
  if (blocked) return fail(blocked);

  const meta = sourceMeta(source);
  if (!meta) return fail(`Unknown Pentagon source "${source}".`);
  const n = Math.min(Math.max(Number(limit) || 25, 1), 200);

  try {
    if (meta.scope === "business") {
      const { data, error } = await supabase.rpc("pentagon", {
        p_source: source,
        p_limit: n,
        p_from: source === "store" && day ? day : null,
        p_to: source === "store" && to ? to : null,
      });
      if (error) return fail(readableError(error));
      return { ok: true, data, summary: summarise(source, data) };
    }

    if (source === "calendar") {
      const { fromISO, toISO } = bounds(day || todayKey(), to);
      const { data, error } = await boardroom()
        .from("personal_events")
        .select("id, title, notes, start_time, end_time, all_day, location, category")
        .gte("start_time", fromISO)
        .lt("start_time", toISO)
        .order("start_time", { ascending: true })
        .limit(n);
      if (error) return fail(readableError(error));
      return { ok: true, data, summary: summarise(source, data) };
    }

    if (source === "notes") {
      const { data, error } = await boardroom()
        .from("personal_notes")
        .select("id, title, body, pinned, updated_at")
        .order("pinned", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(n);
      if (error) return fail(readableError(error));
      return { ok: true, data, summary: summarise(source, data) };
    }

    if (source === "birthdays") {
      const { data, error } = await boardroom()
        .from("personal_birthdays")
        .select("id, name, month, day, year, notes")
        .limit(200);
      if (error) return fail(readableError(error));
      const rows = (data || [])
        .map((r) => ({ ...r, inDays: daysUntilBirthday(r.month, r.day) }))
        .sort((a, b) => a.inDays - b.inDays)
        .slice(0, n);
      return { ok: true, data: rows, summary: summarise(source, rows) };
    }

    if (source === "upkeep") {
      const { data, error } = await boardroom()
        .from("upkeep_items")
        .select("id, name, interval_days, last_done, notes")
        .limit(n);
      if (error) return fail(readableError(error));
      const today = todayKey();
      const rows = (data || []).map((r) => {
        if (!r.last_done) return { ...r, due: true, dueOn: null };
        const d = new Date(`${r.last_done}T00:00:00`);
        d.setDate(d.getDate() + (r.interval_days || 90));
        const dueOn = d.toISOString().slice(0, 10);
        return { ...r, dueOn, due: dueOn <= today };
      }).sort((a, b) => Number(b.due) - Number(a.due));
      return { ok: true, data: rows, summary: summarise(source, rows) };
    }

    if (source === "groceries") {
      let q = boardroom()
        .from("grocery_items")
        .select("id, item, checked, created_at")
        .order("checked", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(n);
      if (!includeChecked) q = q.eq("checked", false);
      const { data, error } = await q;
      if (error) return fail(readableError(error));
      return { ok: true, data, summary: summarise(source, data) };
    }

    return fail(`Nothing wired up for "${source}" yet.`);
  } catch (e) {
    return fail(readableError(e));
  }
}

/* ── writes ────────────────────────────────────────────────────────────────── */
// Only the personal tables, and only inserts. Every one returns the row id so
// the ledger entry can carry a `remote` descriptor and Undo can reach back
// across the network to delete it.

async function insert(table, row, select) {
  const c = getCloud();
  const { data, error } = await boardroom()
    .from(table)
    .insert({ ...row, user_id: c.user.id })
    .select(select)
    .single();
  if (error) return fail(readableError(error));
  return { ok: true, data, remote: { schema: "boardroom", table, id: data.id, op: "insert" } };
}

export async function addEvent({ title, startISO, endISO, allDay = false, location = null, notes = "", category = "personal" }) {
  const blocked = guard("calendar");
  if (blocked) return fail(blocked);
  if (!title?.trim()) return fail("An event needs a title.");
  if (!startISO) return fail("An event needs a start time.");
  return insert("personal_events", {
    title: title.trim(),
    start_time: startISO,
    end_time: endISO || null,
    all_day: !!allDay,
    location,
    notes: notes || "",
    category: category || "personal",
  }, "id, title, start_time, end_time, all_day");
}

export async function addNote({ title = "", body = "" }) {
  const blocked = guard("notes");
  if (blocked) return fail(blocked);
  if (!title.trim() && !body.trim()) return fail("A note needs a title or a body.");
  return insert("personal_notes", { title: title.trim(), body: body.trim() }, "id, title, body");
}

export async function addGrocery(item) {
  const blocked = guard("groceries");
  if (blocked) return fail(blocked);
  const name = String(item || "").trim();
  if (!name) return fail("Nothing to add.");
  return insert("grocery_items", { item: name, checked: false }, "id, item");
}
