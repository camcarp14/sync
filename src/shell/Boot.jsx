import { useEffect, useState } from "react";

// ─── The mark ────────────────────────────────────────────────────────────────
// Two arcs, out of phase, rotating until they line up — then the core lands.
// It is the product's whole idea rendered in 1.6 seconds, and it doubles as
// cover for the first paint: by the time it clears, fonts and state are in.

export function Mark({ size = 22, tone = "var(--accent)" }) {
  const r = 8.4;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r={r} stroke={tone} strokeWidth="1.9" strokeLinecap="round" strokeDasharray={`${Math.PI * r * 0.42} ${Math.PI * 2 * r}`} />
      <circle cx="12" cy="12" r={r} stroke={tone} strokeWidth="1.9" strokeLinecap="round" strokeDasharray={`${Math.PI * r * 0.42} ${Math.PI * 2 * r}`} transform="rotate(180 12 12)" />
      <circle cx="12" cy="12" r="2.4" fill={tone} />
    </svg>
  );
}

export default function Boot({ onDone }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const hold = reduced ? 120 : 1500;
    const a = setTimeout(() => setLeaving(true), hold);
    const b = setTimeout(onDone, hold + (reduced ? 40 : 420));
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [onDone]);

  return (
    <div className={`boot${leaving ? " leaving" : ""}`} role="status" aria-label="Starting SYNC">
      <svg width="76" height="76" viewBox="0 0 76 76" fill="none" className="boot-mark">
        <circle className="ba ba-1" cx="38" cy="38" r="29" />
        <circle className="ba ba-2" cx="38" cy="38" r="29" />
        <circle className="bcore" cx="38" cy="38" r="6" />
      </svg>
      <div className="boot-word">SYNC</div>
      <div className="boot-sub">standing by</div>
    </div>
  );
}
