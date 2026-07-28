// ─── Time, in exactly two shapes ─────────────────────────────────────────────
// A day is a "YYYY-MM-DD" string in the user's local zone. A moment inside a
// day is minutes-from-midnight (0–1439). Everything in SYNC — blocks, focus
// sessions, the now-line, the model's own tool arguments — speaks these two
// shapes and nothing else. No Date objects cross a module boundary, so there
// is exactly one place where a timezone can go wrong: right here.

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;

/** "YYYY-MM-DD" for a timestamp, in local time (not UTC — toISOString lies). */
export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Minutes from local midnight for a timestamp. */
export function minsOfDay(ts = Date.now()) {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

/** Timestamp for a given day key + minutes-from-midnight. */
export function stampFor(day, mins = 0) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 0, mins, 0, 0).getTime();
}

/** Shift a day key by n days. */
export function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return dayKey(dt.getTime());
}

export const isToday = (day) => day === dayKey();

/** "Today" · "Tomorrow" · "Yesterday" · "Thu 14 Aug" */
export function dayLabel(day, { long = false } = {}) {
  if (!day) return "";
  const today = dayKey();
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === addDays(today, -1)) return "Yesterday";
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, long
    ? { weekday: "long", month: "long", day: "numeric" }
    : { weekday: "short", month: "short", day: "numeric" });
}

/** Days between two day keys (b - a), calendar days, sign preserved. */
export function daysBetween(a, b) {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const A = Date.UTC(ay, am - 1, ad);
  const B = Date.UTC(by, bm - 1, bd);
  return Math.round((B - A) / 86400000);
}

/** 545 → "9:05 AM" (or "09:05" where the locale prefers it). */
export function fmtTime(mins, { pad = false } = {}) {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const hh = pad ? String(h12).padStart(2, "0") : String(h12);
  return `${hh}:${mm} ${h24 < 12 ? "AM" : "PM"}`;
}

/** 545 → "09:05" — the 24h form the timeline gutter uses. */
export function fmt24(mins) {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** 95 → "1h 35m" · 45 → "45m" · 120 → "2h" */
export function fmtDur(mins) {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h && r) return `${h}h ${r}m`;
  if (h) return `${h}h`;
  return `${r}m`;
}

/** 3725 seconds → "1:02:05" · 125 → "2:05" — for a running clock. */
export function fmtClock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  if (h) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

/** "just now" · "12m ago" · "3h ago" · "Tue" — for ledger and note stamps. */
export function ago(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  const d = Math.round(s / 86400);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Parse the time shapes a language model actually emits into minutes-from-
 * midnight: "09:30", "9:30am", "9am", "1400", "2:15 PM", "noon", "midnight".
 * Returns null when it can't be read — callers surface that rather than
 * guessing, because a silently wrong meeting time is worse than a question.
 */
export function parseTime(input) {
  if (input == null) return null;
  if (typeof input === "number" && Number.isFinite(input)) {
    return input >= 0 && input < 1440 ? Math.round(input) : null;
  }
  const s = String(input).trim().toLowerCase();
  if (!s) return null;
  if (s === "noon" || s === "midday") return 720;
  if (s === "midnight") return 0;

  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (m) {
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const mer = m[3]?.replace(/\./g, "");
    if (min > 59) return null;
    if (mer === "am") { if (h === 12) h = 0; }
    else if (mer === "pm") { if (h < 12) h += 12; }
    if (h > 23) return null;
    return h * 60 + min;
  }
  // bare military form: "1400", "0930"
  const mil = s.match(/^(\d{2})(\d{2})$/);
  if (mil) {
    const h = Number(mil[1]);
    const min = Number(mil[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }
  return null;
}

/**
 * Parse the day shapes a model emits: "today", "tomorrow", "yesterday",
 * "2026-08-14", "monday" (the next one, today counting as a match), or a
 * "+3d" offset. Returns null when unreadable.
 */
export function parseDay(input, today = dayKey()) {
  if (input == null) return null;
  const s = String(input).trim().toLowerCase();
  if (!s) return null;
  if (s === "today") return today;
  if (s === "tomorrow" || s === "tmw") return addDays(today, 1);
  if (s === "yesterday") return addDays(today, -1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const off = s.match(/^([+-])(\d+)\s*d(ays?)?$/);
  if (off) return addDays(today, (off[1] === "-" ? -1 : 1) * Number(off[2]));

  const NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const idx = NAMES.findIndex((n) => n === s || n.slice(0, 3) === s);
  if (idx >= 0) {
    const [y, mo, d] = today.split("-").map(Number);
    const cur = new Date(y, mo - 1, d).getDay();
    // "monday" said on a Monday means today, not eight days out.
    const delta = (idx - cur + 7) % 7;
    return addDays(today, delta);
  }
  return null;
}

/** "Good morning" · "Good afternoon" · "Good evening" — used once, on arrival. */
export function greeting(mins = minsOfDay()) {
  if (mins < 5 * 60) return "Still up";
  if (mins < 12 * 60) return "Good morning";
  if (mins < 17 * 60) return "Good afternoon";
  return "Good evening";
}
