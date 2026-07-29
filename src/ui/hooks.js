import { useState, useEffect, useRef, useCallback } from "react";

// ─── useTween ────────────────────────────────────────────────────────────────
// Numbers behave like instruments: they travel to their value instead of
// snapping. Same ease-out curve as the rest of the house, and it respects
// prefers-reduced-motion by landing on the value immediately.
const REDUCED = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function useTween(target, ms = 620) {
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef(0);

  useEffect(() => {
    if (target == null) { setShown(null); return; }
    const from = fromRef.current;
    if (from == null || REDUCED() || from === target) {
      fromRef.current = target;
      setShown(target);
      return;
    }
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / ms);
      // cubic ease-out — the curve --ease-out approximates
      const e = 1 - Math.pow(1 - p, 3);
      setShown(from + (target - from) * e);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, ms]);

  return shown;
}

// ─── useNow ──────────────────────────────────────────────────────────────────
// A shared clock. Every consumer of "what time is it" reads this so the now-line
// on the timeline, the countdown on a focus session, and the greeting all move
// on the same tick instead of drifting apart.
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    // A tab that was backgrounded gets a correct clock the instant it returns,
    // rather than up to intervalMs of stale time.
    const onVis = () => { if (!document.hidden) setNow(Date.now()); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [intervalMs]);
  return now;
}

// ─── useMedia ────────────────────────────────────────────────────────────────
// A media query as state. Used where a breakpoint has to change a *value* (a
// canvas needs real pixels, not a CSS rule) rather than just a style.
export function useMedia(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && window.matchMedia(query).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = (e) => setMatches(e.matches);
    setMatches(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

// ─── useEvent ────────────────────────────────────────────────────────────────
// A callback with a stable identity that always sees the latest render's
// closure. Lets effects register listeners once without stale-closure bugs.
export function useEvent(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args) => ref.current?.(...args), []);
}

// ─── useHotkey ───────────────────────────────────────────────────────────────
// Global keyboard affordances. Never fires while the user is typing into a
// field unless the binding explicitly allows it (⌘K and Escape do).
function inEditable(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function useHotkey(combo, handler, { allowInField = false, enabled = true } = {}) {
  const cb = useEvent(handler);
  useEffect(() => {
    if (!enabled) return;
    const parts = combo.toLowerCase().split("+");
    const key = parts[parts.length - 1];
    const needMod = parts.includes("mod");
    const needShift = parts.includes("shift");
    const onKey = (e) => {
      if (!allowInField && inEditable(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (needMod !== mod) return;
      if (needShift !== e.shiftKey) return;
      const k = e.key.toLowerCase();
      const matches = key === "space" ? (k === " " || e.code === "Space") : k === key;
      if (!matches) return;
      cb(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [combo, allowInField, enabled, cb]);
}
