import { IcConsole, IcDay, IcQueue, IcBrief, IcMemory } from "../ui/icons.jsx";
import { dayKey } from "../lib/time.js";

// Five destinations, one flat list. The Console is first because it is where
// the work actually happens; everything else is a place to look at what the
// Console did.
export const NAV = [
  { key: "console", label: "Console", Icon: IcConsole, hint: "Talk to SYNC" },
  { key: "day", label: "Day", Icon: IcDay, hint: "The plan" },
  { key: "queue", label: "Queue", Icon: IcQueue, hint: "Tasks and follow-ups" },
  { key: "brief", label: "Brief", Icon: IcBrief, hint: "Morning and evening" },
  { key: "memory", label: "Memory", Icon: IcMemory, hint: "What SYNC knows" },
];

/** The count each destination shows in the rail — attention, not decoration. */
export function navBadges(s) {
  const today = dayKey();
  const open = s.tasks.filter((t) => t.status === "open");
  return {
    console: 0,
    day: s.blocks.filter((b) => b.day === today && b.status !== "done").length,
    queue: open.length + s.followups.filter((f) => f.status === "open" && f.due && f.due <= today).length,
    brief: 0,
    memory: 0,
  };
}
