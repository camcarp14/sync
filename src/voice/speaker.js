// ─── The voice ───────────────────────────────────────────────────────────────
// speechSynthesis, made reliable. Three things this file exists to fix:
//   1. Chrome silently kills any utterance running past ~15 seconds. Everything
//      is chunked under that ceiling and a resume() heartbeat runs while
//      speaking, which is the documented workaround and the only one that
//      actually holds.
//   2. Model output is written text. Markdown, ids and bare URLs read terribly
//      out loud, so they're stripped or rewritten before they reach the queue.
//   3. Sentences arrive from the stream one at a time. The queue starts
//      speaking the first one while the rest is still being generated, which is
//      most of the difference between "fast" and "sluggish".

const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
export const supported = !!synth;

/* ── voice selection ───────────────────────────────────────────────────────── */
// Ranked by how they actually sound reading a sentence of prose, best first.
// Anything not on the list still works; it just isn't preferred.
const PREFERRED = [
  "Google UK English Male", "Google US English", "Microsoft Guy Online", "Microsoft Ryan Online",
  "Microsoft Aria Online", "Daniel", "Serena", "Samantha", "Alex", "Karen", "Tessa",
];

let voicesCache = [];

export function listVoices() {
  if (!synth) return [];
  const all = synth.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("en"));
  if (all.length) voicesCache = all;
  const rank = (v) => {
    const i = PREFERRED.findIndex((p) => v.name.includes(p));
    return i === -1 ? PREFERRED.length + (v.localService ? 1 : 0) : i;
  };
  return [...voicesCache].sort((a, b) => rank(a) - rank(b));
}

export function defaultVoiceURI() {
  return listVoices()[0]?.voiceURI || null;
}

// Voices load asynchronously in every browser; this fires once they exist so
// Settings can render the real list instead of an empty select.
export function onVoicesReady(cb) {
  if (!synth) return () => {};
  if (listVoices().length) { cb(listVoices()); return () => {}; }
  const handler = () => cb(listVoices());
  synth.addEventListener("voiceschanged", handler);
  return () => synth.removeEventListener("voiceschanged", handler);
}

/* ── text → speech-ready text ──────────────────────────────────────────────── */
export function speakable(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " code block ")     // never read a code fence aloud
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-•*]\s+/gm, "")                      // list bullets read as "dash"
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")         // links: keep the label
    .replace(/https?:\/\/(www\.)?([^\s/]+)\S*/g, "$2") // bare URLs: just the host
    .replace(/\b[a-z]\w{6,}\d\w*\b/g, "")            // internal ids ("k9x2mf1q3ab")
    .replace(/&/g, " and ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// speechSynthesis chokes on long utterances. Split on sentence boundaries, then
// on commas, then hard-wrap — never mid-word.
export function chunk(text, max = 190) {
  const out = [];
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) || [text];
  let buf = "";
  const push = () => { if (buf.trim()) out.push(buf.trim()); buf = ""; };
  for (const s of sentences) {
    if (s.length > max) {
      push();
      let rest = s;
      while (rest.length > max) {
        let cut = rest.lastIndexOf(",", max);
        if (cut < max * 0.4) cut = rest.lastIndexOf(" ", max);
        if (cut <= 0) cut = max;
        out.push(rest.slice(0, cut + 1).trim());
        rest = rest.slice(cut + 1);
      }
      buf = rest;
    } else if ((buf + s).length > max) {
      push();
      buf = s;
    } else {
      buf += s;
    }
  }
  push();
  return out.filter(Boolean);
}

/* ── the queue ─────────────────────────────────────────────────────────────── */
let queue = [];
let active = null;
let heartbeat = 0;
let listeners = { start: new Set(), end: new Set() };
let recentlySpoken = [];   // what barge-in detection must ignore as echo

export const onSpeechStart = (fn) => { listeners.start.add(fn); return () => listeners.start.delete(fn); };
export const onSpeechEnd = (fn) => { listeners.end.add(fn); return () => listeners.end.delete(fn); };

export const isSpeaking = () => !!active || queue.length > 0;

/** Text SYNC said in the last few seconds — used to reject microphone echo. */
export function echoWindow() {
  const cutoff = Date.now() - 9000;
  recentlySpoken = recentlySpoken.filter((r) => r.at > cutoff);
  return recentlySpoken.map((r) => r.text).join(" ").toLowerCase();
}

function startHeartbeat() {
  clearInterval(heartbeat);
  // Chrome pauses long-running synthesis unless it is poked. Harmless
  // elsewhere; load-bearing there.
  heartbeat = setInterval(() => {
    if (!synth) return;
    if (synth.speaking && !synth.paused) { synth.pause(); synth.resume(); }
  }, 6000);
}

function stopHeartbeat() { clearInterval(heartbeat); heartbeat = 0; }

function pump(opts) {
  if (!synth || active) return;
  const next = queue.shift();
  if (!next) {
    stopHeartbeat();
    for (const fn of listeners.end) fn();
    return;
  }
  const u = new SpeechSynthesisUtterance(next.text);
  const voice = listVoices().find((v) => v.voiceURI === next.voiceURI);
  if (voice) u.voice = voice;
  u.rate = next.rate;
  u.pitch = next.pitch;
  u.volume = 1;

  u.onend = () => { active = null; pump(opts); };
  u.onerror = () => { active = null; pump(opts); };

  active = u;
  recentlySpoken.push({ text: next.text, at: Date.now() });
  startHeartbeat();
  try { synth.speak(u); }
  catch { active = null; }
}

/**
 * Queue text to be spoken. Returns false when speech isn't available so the
 * caller can fall back to showing the reply rather than silently doing nothing.
 */
export function say(text, { voiceURI, rate = 1.03, pitch = 1 } = {}) {
  if (!synth) return false;
  const clean = speakable(text);
  if (!clean) return true;
  const wasIdle = !isSpeaking();
  for (const part of chunk(clean)) queue.push({ text: part, voiceURI, rate, pitch });
  if (wasIdle) for (const fn of listeners.start) fn();
  pump();
  return true;
}

/** Stop immediately and drop anything queued — what barge-in calls. */
export function shutUp() {
  if (!synth) return;
  queue = [];
  active = null;
  stopHeartbeat();
  try { synth.cancel(); } catch { /* already idle */ }
  for (const fn of listeners.end) fn();
}

// A tab that goes away mid-sentence should not come back still talking.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => { if (document.hidden) shutUp(); });
}
