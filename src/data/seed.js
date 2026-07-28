// ─── First-run defaults ──────────────────────────────────────────────────────
// Onboarding pre-fills these; every one of them is editable before it is saved
// and afterwards on the Memory page. Nothing here is load-bearing — an empty
// profile works, it just makes SYNC ask more questions on day one.

export const STARTER_VENTURES = [
  { key: "clarify", name: "Clarify Paid Search", tone: "var(--amber)", note: "Boutique Google Ads agency — high-value local service verticals. Outreach pipeline, client delivery, retainer growth." },
  { key: "zts", name: "Zero To Secure", tone: "var(--green)", note: "Stainless seed-phrase backup kit, DTC on Shopify. Creator collabs, Shorts, SEO, conversion." },
  { key: "dayjob", name: "Day job", tone: "var(--blue)", note: "Paid search analyst work — client portfolio, standups, reporting cycles." },
  { key: "personal", name: "Personal", tone: "var(--purple)", note: "Everything that isn't work but still needs to happen today." },
];

export const STARTER_DIRECTIVES = [
  "Protect deep-work blocks — never schedule over one without saying so out loud.",
  "Pressure-test, don't validate. If a plan is weak, say which part and why.",
  "Default to executing. Ask one clarifying question at most, then act.",
];

export const BLOCK_KINDS = [
  { key: "deep", label: "Deep work", tone: "var(--accent)" },
  { key: "meeting", label: "Meeting", tone: "var(--purple)" },
  { key: "admin", label: "Admin", tone: "var(--faint)" },
  { key: "outreach", label: "Outreach", tone: "var(--amber)" },
  { key: "break", label: "Break", tone: "var(--green)" },
  { key: "personal", label: "Personal", tone: "var(--pink)" },
];

export const kindMeta = (k) => BLOCK_KINDS.find((b) => b.key === k) || BLOCK_KINDS[2];

export const PRIORITIES = [
  { key: "now", label: "Now", tone: "var(--red)" },
  { key: "high", label: "High", tone: "var(--amber)" },
  { key: "normal", label: "Normal", tone: "var(--sub)" },
  { key: "low", label: "Low", tone: "var(--faint)" },
];

export const priorityMeta = (p) => PRIORITIES.find((x) => x.key === p) || PRIORITIES[2];
export const PRIORITY_RANK = { now: 0, high: 1, normal: 2, low: 3 };
