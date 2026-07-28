// The time module is the one place a timezone bug can hide, and every tool the
// model calls parses its arguments through it. It gets the most tests.

import { installBrowserEnv, check, eq, report } from "./_env.mjs";
installBrowserEnv();

const {
  dayKey, minsOfDay, stampFor, addDays, dayLabel, daysBetween,
  fmtTime, fmt24, fmtDur, fmtClock, ago, parseTime, parseDay, greeting,
} = await import("../src/lib/time.js");

/* ── day keys are local, never UTC ─────────────────────────────────────────── */
const localNoon = new Date(2026, 7, 14, 12, 0, 0).getTime();
eq("dayKey at local noon", dayKey(localNoon), "2026-08-14");

// The classic failure: 11pm local on the 14th is the 15th in UTC for anyone
// west of Greenwich. toISOString().slice(0,10) gets this wrong; we must not.
const lateNight = new Date(2026, 7, 14, 23, 30, 0).getTime();
eq("dayKey late at night stays on the same local day", dayKey(lateNight), "2026-08-14");

const earlyMorning = new Date(2026, 7, 14, 0, 15, 0).getTime();
eq("dayKey just after midnight", dayKey(earlyMorning), "2026-08-14");

eq("minsOfDay", minsOfDay(new Date(2026, 7, 14, 9, 5).getTime()), 545);
eq("stampFor round-trips", dayKey(stampFor("2026-08-14", 545)), "2026-08-14");
eq("stampFor minutes round-trip", minsOfDay(stampFor("2026-08-14", 545)), 545);

/* ── date arithmetic across a month boundary ───────────────────────────────── */
eq("addDays forward over month end", addDays("2026-08-31", 1), "2026-09-01");
eq("addDays backward over month end", addDays("2026-09-01", -1), "2026-08-31");
eq("addDays over a year end", addDays("2026-12-31", 1), "2027-01-01");
eq("daysBetween", daysBetween("2026-08-14", "2026-08-20"), 6);
eq("daysBetween negative", daysBetween("2026-08-20", "2026-08-14"), -6);
eq("daysBetween across a month", daysBetween("2026-08-31", "2026-09-02"), 2);

/* ── labels ────────────────────────────────────────────────────────────────── */
const today = dayKey();
eq("dayLabel today", dayLabel(today), "Today");
eq("dayLabel tomorrow", dayLabel(addDays(today, 1)), "Tomorrow");
eq("dayLabel yesterday", dayLabel(addDays(today, -1)), "Yesterday");
check("dayLabel far future is a real date", /\w/.test(dayLabel(addDays(today, 40))));

/* ── formatting ────────────────────────────────────────────────────────────── */
eq("fmtTime morning", fmtTime(545), "9:05 AM");
eq("fmtTime noon", fmtTime(720), "12:00 PM");
eq("fmtTime midnight", fmtTime(0), "12:00 AM");
eq("fmtTime afternoon", fmtTime(870), "2:30 PM");
eq("fmtTime wraps past midnight", fmtTime(1500), "1:00 AM");
eq("fmt24", fmt24(545), "09:05");
eq("fmt24 midnight", fmt24(0), "00:00");
eq("fmtDur hours and minutes", fmtDur(95), "1h 35m");
eq("fmtDur whole hours", fmtDur(120), "2h");
eq("fmtDur minutes only", fmtDur(45), "45m");
eq("fmtClock under an hour", fmtClock(125), "2:05");
eq("fmtClock over an hour", fmtClock(3725), "1:02:05");
eq("ago just now", ago(Date.now() - 5000, Date.now()), "just now");
eq("ago minutes", ago(Date.now() - 12 * 60000, Date.now()), "12m ago");
eq("ago hours", ago(Date.now() - 3 * 3600000, Date.now()), "3h ago");

/* ── parsing what a model actually emits ───────────────────────────────────── */
eq("parseTime 24h", parseTime("09:30"), 570);
eq("parseTime 12h lower", parseTime("9:30am"), 570);
eq("parseTime 12h spaced", parseTime("2:15 PM"), 855);
eq("parseTime bare hour with meridiem", parseTime("9am"), 540);
eq("parseTime pm bare hour", parseTime("2pm"), 840);
eq("parseTime 12am is midnight", parseTime("12am"), 0);
eq("parseTime 12pm is noon", parseTime("12pm"), 720);
eq("parseTime dotted meridiem", parseTime("9:30 a.m."), 570);
eq("parseTime military", parseTime("1400"), 840);
eq("parseTime military with leading zero", parseTime("0930"), 570);
eq("parseTime noon word", parseTime("noon"), 720);
eq("parseTime midnight word", parseTime("midnight"), 0);
eq("parseTime passes a number through", parseTime(545), 545);
eq("parseTime rejects nonsense", parseTime("later"), null);
eq("parseTime rejects impossible minutes", parseTime("09:75"), null);
eq("parseTime rejects impossible hours", parseTime("2515"), null);
eq("parseTime rejects empty", parseTime(""), null);
eq("parseTime rejects null", parseTime(null), null);

eq("parseDay today", parseDay("today", "2026-08-14"), "2026-08-14");
eq("parseDay tomorrow", parseDay("tomorrow", "2026-08-14"), "2026-08-15");
eq("parseDay yesterday", parseDay("yesterday", "2026-08-14"), "2026-08-13");
eq("parseDay iso passes through", parseDay("2026-09-01", "2026-08-14"), "2026-09-01");
eq("parseDay offset", parseDay("+3d", "2026-08-14"), "2026-08-17");
eq("parseDay negative offset", parseDay("-2d", "2026-08-14"), "2026-08-12");
// 2026-08-14 is a Friday.
eq("parseDay weekday name", parseDay("monday", "2026-08-14"), "2026-08-17");
eq("parseDay same weekday means today", parseDay("friday", "2026-08-14"), "2026-08-14");
eq("parseDay short weekday", parseDay("wed", "2026-08-14"), "2026-08-19");
eq("parseDay rejects nonsense", parseDay("sometime", "2026-08-14"), null);

/* ── greeting ──────────────────────────────────────────────────────────────── */
eq("greeting overnight", greeting(3 * 60), "Still up");
eq("greeting morning", greeting(9 * 60), "Good morning");
eq("greeting afternoon", greeting(14 * 60), "Good afternoon");
eq("greeting evening", greeting(20 * 60), "Good evening");

report("time");
