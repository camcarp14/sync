// ─── What the Pentagon can be asked for ──────────────────────────────────────
// A closed registry, deliberately. The model picks a key from this list; it
// never composes a query. Two consequences worth stating out loud:
//   · there is no injection surface — `source` selects a branch, nothing more
//   · every source is documented in one place, which is also what the model
//     reads to decide whether it needs to look at all
//
// Pure module: no Supabase import, no browser globals. The IO half lives in
// pentagon.js, so this can be exercised under plain node.

import { fmtTime } from "../lib/time.js";

/**
 * scope "personal" — Board Room's own tables, scoped to the signed-in user by
 * row-level security, readable and writable.
 * scope "business" — org-wide Clarify / ZTS data, read-only, reached through
 * sync.pentagon() which checks ownership first.
 */
export const SOURCES = [
  { key: "calendar",  scope: "personal", label: "Calendar",   desc: "Real calendar events from Board Room for a given day or range. This is the actual calendar, not SYNC's own day plan." },
  { key: "notes",     scope: "personal", label: "Notes",      desc: "Personal notes kept in Board Room, newest first. Pinned ones first." },
  { key: "birthdays", scope: "personal", label: "Birthdays",  desc: "Birthdays on record, with how many days away each one is." },
  { key: "upkeep",    scope: "personal", label: "Upkeep",     desc: "Recurring maintenance items and whether each is due." },
  { key: "groceries", scope: "personal", label: "Groceries",  desc: "The shared grocery list, unchecked items first." },

  { key: "pipeline",  scope: "business", label: "Pipeline",   desc: "One-breath rollup of the whole sales pipeline: prospect count, new leads, outreach by status, replies in the last week, meetings ahead, follow-ups due. Start here for any 'how are we doing' question." },
  { key: "prospects", scope: "business", label: "Prospects",  desc: "Prospected businesses with city, category, site and whether they're running ads." },
  { key: "outreach",  scope: "business", label: "Outreach",   desc: "Outreach threads: status, what was sent, replies, how a reply was classified, meetings booked, follow-ups due." },
  { key: "leads",     scope: "business", label: "Inbound",    desc: "Inbound leads from the site, newest first, with spend and service asked for." },
  { key: "clients",   scope: "business", label: "Clients",    desc: "Active ad clients with budget, CPA and ROAS targets." },
  { key: "findings",  scope: "business", label: "Findings",   desc: "Account findings the auditor raised, with severity and recommendation." },
  { key: "store",     scope: "business", label: "Store",      desc: "ZTS daily store numbers: real orders, revenue, unfulfilled, product counts. Newest day first." },
  { key: "ops",       scope: "business", label: "Ops",        desc: "Automation control switches and the last few operational runs." },
];

export const SOURCE_KEYS = SOURCES.map((s) => s.key);
export const sourceMeta = (key) => SOURCES.find((s) => s.key === key) || null;
export const isPersonal = (key) => sourceMeta(key)?.scope === "personal";

/** The catalogue as the model sees it, inlined into the tool description. */
export function sourceCatalogue() {
  return SOURCES.map((s) => `· ${s.key} — ${s.desc}`).join("\n");
}

/* ── shaping ───────────────────────────────────────────────────────────────── */
const money = (n) => (n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

/** Days until the next occurrence of a month/day, ignoring the year. */
export function daysUntilBirthday(month, day, today = new Date()) {
  const y = today.getFullYear();
  const at = (yr) => new Date(yr, month - 1, day);
  const start = new Date(y, today.getMonth(), today.getDate());
  let next = at(y);
  if (next < start) next = at(y + 1);
  return Math.round((next - start) / 86400000);
}

/**
 * One line a person would actually say. This is what lands in the console and
 * the ledger; the model gets the rows themselves.
 */
export function summarise(key, data) {
  const rows = Array.isArray(data) ? data : [];
  switch (key) {
    case "calendar":
      if (!rows.length) return "Nothing on the calendar";
      return rows.length === 1
        ? `1 event — ${rows[0].title}`
        : `${rows.length} events, starting with ${rows[0].title}`;
    case "notes":
      return rows.length ? plural(rows.length, "note") : "No notes";
    case "birthdays": {
      if (!rows.length) return "No birthdays on record";
      const soon = rows.filter((r) => r.inDays != null && r.inDays <= 30);
      return soon.length ? `${plural(soon.length, "birthday")} within a month` : `${plural(rows.length, "birthday")} on record`;
    }
    case "upkeep": {
      const due = rows.filter((r) => r.due);
      return due.length ? `${plural(due.length, "upkeep item")} due` : `${plural(rows.length, "upkeep item")}, none due`;
    }
    case "groceries": {
      const open = rows.filter((r) => !r.checked);
      return open.length ? `${plural(open.length, "item")} on the list` : "Grocery list is clear";
    }
    case "pipeline": {
      const d = data || {};
      const bits = [
        `${d.prospects ?? 0} prospects`,
        d.new_leads ? `${d.new_leads} new leads` : null,
        d.replies_7d ? `${d.replies_7d} replies this week` : null,
        d.meetings_ahead ? `${d.meetings_ahead} meetings ahead` : null,
        d.due_followups ? `${d.due_followups} follow-ups due` : null,
      ].filter(Boolean);
      return bits.join(", ");
    }
    case "prospects": return rows.length ? plural(rows.length, "prospect") : "No prospects";
    case "outreach": {
      if (!rows.length) return "No outreach";
      const replied = rows.filter((r) => r.replied_at).length;
      return replied ? `${plural(rows.length, "thread")}, ${replied} replied` : plural(rows.length, "thread");
    }
    case "leads": return rows.length ? plural(rows.length, "inbound lead") : "No inbound leads";
    case "clients": return rows.length ? plural(rows.length, "client") : "No clients";
    case "findings": {
      if (!rows.length) return "No findings";
      const bad = rows.filter((r) => r.severity === "high" || r.severity === "critical").length;
      return bad ? `${plural(rows.length, "finding")}, ${bad} serious` : plural(rows.length, "finding");
    }
    case "store": {
      if (!rows.length) return "No store days recorded";
      const d = rows[0];
      return `${d.day}: ${d.orders_real ?? 0} real orders, ${money(d.real_revenue_usd)}`;
    }
    case "ops": {
      const ctl = data?.control || [];
      const off = ctl.filter((c) => !c.enabled).length;
      return off ? `${plural(ctl.length, "subsystem")}, ${off} paused` : `${plural(ctl.length, "subsystem")}, all running`;
    }
    default:
      return rows.length ? plural(rows.length, "row") : "Nothing";
  }
}

/** Calendar rows read out loud the way a person says a time. */
export function calendarLine(ev) {
  if (ev.all_day) return `all day · ${ev.title}`;
  const d = new Date(ev.start_time);
  const mins = d.getHours() * 60 + d.getMinutes();
  return `${fmtTime(mins)} · ${ev.title}${ev.location ? ` (${ev.location})` : ""}`;
}
