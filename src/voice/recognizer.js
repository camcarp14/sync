// ─── The ear ─────────────────────────────────────────────────────────────────
// A wrapper around SpeechRecognition that behaves like a product instead of a
// demo. It handles the four things the raw API gets wrong for this use case:
//
//   · It ends on its own, constantly. Chrome stops a session after a stretch of
//     silence and after roughly a minute of audio. We restart, with backoff, so
//     from the outside the ear is simply always open.
//   · There is no endpointing you'd want. "Final" fires mid-thought. We hold a
//     short silence window after the last result before committing, so a pause
//     for breath doesn't cut a sentence in half.
//   · A wake word needs its own mode. In ambient mode nothing is committed
//     until the name is heard; everything after it in the same breath is kept,
//     so "Sync, move my two o'clock" works in one go.
//   · The microphone hears the speakers. Anything that matches what SYNC just
//     said is dropped as echo, which is what makes leaving ambient mode on
//     while it talks survivable.

import { echoWindow } from "./speaker.js";

const Ctor = typeof window !== "undefined"
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export const supported = !!Ctor;

const SILENCE_MS = 1150;      // how long a pause has to be to end a command
const RESTART_MS = 260;       // gap before reopening a session that ended itself
const MAX_BACKOFF = 8000;

const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

/**
 * True when what we heard looks like our own speakers coming back at us.
 * Requires a decent run of consecutive words to match, so a user genuinely
 * repeating a word SYNC just used is not swallowed.
 */
function looksLikeEcho(heard) {
  const spoken = echoWindow();
  if (!spoken) return false;
  const h = words(heard);
  if (h.length < 3) return false;
  for (let i = 0; i + 3 <= h.length; i++) {
    if (spoken.includes(h.slice(i, i + 4).join(" ")) || spoken.includes(h.slice(i, i + 3).join(" "))) return true;
  }
  return false;
}

/**
 * Find the wake word and return everything said after it. Tolerates the
 * mishearings this particular name actually produces ("sink", "think", "sync's").
 */
const WAKE_ALIASES = { sync: ["sync", "sink", "sinc", "syncs", "think", "cink", "sync's"] };

export function afterWake(text, wake = "sync") {
  const aliases = WAKE_ALIASES[wake.toLowerCase()] || [wake.toLowerCase()];
  const w = words(text);
  for (let i = 0; i < w.length; i++) {
    if (aliases.includes(w[i])) {
      return { hit: true, rest: w.slice(i + 1).join(" ") };
    }
  }
  return { hit: false, rest: "" };
}

/**
 * @param {object} o
 * @param {function} o.onInterim  (text) => void — live, unstable transcript
 * @param {function} o.onCommit   (text) => void — a finished utterance
 * @param {function} o.onState    ("off"|"ambient"|"capturing") => void
 * @param {function} o.onError    ({kind, message}) => void
 * @param {function} o.getWake    () => string
 */
export function createRecognizer({ onInterim, onCommit, onState, onError, getWake = () => "sync" }) {
  if (!Ctor) {
    return {
      supported: false,
      start: () => {},
      stop: () => {},
      capture: () => {},
      commitNow: () => {},
      cancel: () => {},
      mode: () => "off",
      listening: () => false,
      destroy: () => {},
    };
  }

  let rec = null;
  let wanted = false;          // should a session be open at all
  // `ambient` and `wanted` are deliberately separate. Push-to-talk opens the
  // microphone for one utterance; when that utterance ends the ear must close
  // again unless wake-word listening was actually switched on. Collapsing
  // these into one flag leaves the mic live after every hold — a live
  // microphone the user never asked for is not a rounding error.
  let ambient = false;
  let mode = "off";            // "off" | "ambient" | "capturing"
  let buffer = "";             // committed-final text for the current command
  let interim = "";
  let silenceTimer = 0;
  let restartTimer = 0;
  let backoff = RESTART_MS;
  let starting = false;

  const setMode = (m) => {
    if (mode === m) return;
    mode = m;
    onState?.(m);
  };

  const clearSilence = () => { clearTimeout(silenceTimer); silenceTimer = 0; };

  /** Where the ear goes once a command has been taken. */
  const settle = () => {
    if (ambient) { setMode("ambient"); return; }
    wanted = false;
    clearTimeout(restartTimer);
    setMode("off");
    try { rec?.stop(); } catch { /* not running */ }
  };

  const commit = () => {
    clearSilence();
    const text = `${buffer} ${interim}`.replace(/\s+/g, " ").trim();
    buffer = ""; interim = "";
    onInterim?.("");
    settle();
    if (!text || looksLikeEcho(text)) return;
    onCommit?.(text);
  };

  const armSilence = () => {
    clearSilence();
    silenceTimer = setTimeout(commit, SILENCE_MS);
  };

  const build = () => {
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US";

    r.onresult = (e) => {
      let finals = "";
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finals += res[0].transcript;
        else live += res[0].transcript;
      }
      const heardNow = `${finals} ${live}`.trim();
      if (!heardNow) return;

      if (mode === "capturing") {
        if (finals) buffer += (buffer ? " " : "") + finals.trim();
        interim = live.trim();
        onInterim?.(`${buffer} ${interim}`.trim());
        armSilence();
        return;
      }

      // Ambient: nothing is a command until the name lands. Echo of our own
      // speech is dropped before the wake test, not after.
      if (looksLikeEcho(heardNow)) return;
      const { hit, rest } = afterWake(heardNow, getWake());
      if (!hit) { onInterim?.(""); return; }
      setMode("capturing");
      buffer = rest;
      interim = "";
      onInterim?.(buffer);
      armSilence();
    };

    r.onerror = (e) => {
      const kind = e.error || "unknown";
      if (kind === "no-speech" || kind === "aborted") return;   // routine, not failures
      if (kind === "not-allowed" || kind === "service-not-allowed") {
        wanted = false;
        setMode("off");
        onError?.({ kind: "denied", message: "Microphone access is blocked. Allow it in the browser's site settings, then turn listening back on." });
        return;
      }
      if (kind === "network") {
        onError?.({ kind: "network", message: "Speech recognition lost its connection. It'll keep trying." });
        return;
      }
      onError?.({ kind, message: `Microphone error: ${kind}` });
    };

    r.onend = () => {
      starting = false;
      // A session that ends while a command is mid-flight must not lose it.
      if (mode === "capturing" && (buffer || interim)) { commit(); return; }
      if (!wanted) { setMode("off"); return; }
      clearTimeout(restartTimer);
      restartTimer = setTimeout(open, backoff);
      backoff = Math.min(MAX_BACKOFF, Math.round(backoff * 1.6));
    };

    r.onstart = () => { starting = false; backoff = RESTART_MS; };
    return r;
  };

  const open = () => {
    if (!wanted || starting) return;
    try {
      rec = rec || build();
      starting = true;
      rec.start();
    } catch (e) {
      starting = false;
      // "already started" is the common one and is harmless — the session we
      // wanted is already open.
      if (!/already/i.test(e?.message || "")) {
        onError?.({ kind: "start", message: "Couldn't open the microphone." });
      }
    }
  };

  return {
    supported: true,

    /** Open the ear for the wake word and keep it open. */
    start() {
      ambient = true;
      wanted = true;
      backoff = RESTART_MS;
      buffer = ""; interim = "";
      setMode("ambient");
      open();
    },

    /** Close the ear entirely, including wake-word listening. */
    stop() {
      ambient = false;
      wanted = false;
      clearSilence();
      clearTimeout(restartTimer);
      buffer = ""; interim = "";
      onInterim?.("");
      setMode("off");
      try { rec?.stop(); } catch { /* not running */ }
    },

    /**
     * Take one utterance right now — what the orb tap and push-to-talk do.
     * Does not turn wake-word listening on; when the utterance ends the ear
     * returns to whatever it was doing before.
     */
    capture() {
      wanted = true;
      backoff = RESTART_MS;
      buffer = ""; interim = "";
      setMode("capturing");
      armSilence();
      open();
    },

    /** Commit whatever has been heard right now (push-to-talk release). */
    commitNow() {
      if (mode === "capturing") commit();
    },

    /** Drop the current command without running it. */
    cancel() {
      clearSilence();
      buffer = ""; interim = "";
      onInterim?.("");
      settle();
    },

    mode: () => mode,
    listening: () => ambient,

    destroy() {
      ambient = false;
      wanted = false;
      clearSilence();
      clearTimeout(restartTimer);
      try { rec?.abort(); } catch { /* nothing open */ }
      rec = null;
    },
  };
}

/* ── microphone level, for the orb ─────────────────────────────────────────── */
// A separate getUserMedia stream feeding an AnalyserNode. It exists only so the
// orb can breathe with the room; if the browser refuses a second stream, the
// orb falls back to its idle animation and nothing else notices.
export async function createMeter() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    return {
      /** 0..1, weighted toward speech frequencies. */
      level() {
        analyser.getByteFrequencyData(data);
        // Roughly 150Hz–3.5kHz across a 512-point FFT at typical sample rates —
        // the band where a voice actually lives, so keyboard noise moves it less.
        let sum = 0, n = 0;
        for (let i = 2; i < 44; i++) { sum += data[i]; n++; }
        return Math.min(1, (sum / n / 255) * 2.1);
      },
      close() {
        try { stream.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ }
        try { ctx.close(); } catch { /* already closed */ }
      },
    };
  } catch {
    return null;
  }
}
