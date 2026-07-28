import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createRecognizer, createMeter, supported as sttSupported } from "./recognizer.js";
import * as speaker from "./speaker.js";
import { runTurn } from "../agent/runtime.js";
import { getState, setSettings } from "../data/store.js";
import { useStore } from "../data/useStore.js";

// ─── The loop ────────────────────────────────────────────────────────────────
// Ear → model → mouth, and the state machine that keeps those three from
// talking over each other. Every surface in the app reads its status from here,
// so the orb, the dock and the transcript can never disagree about what SYNC
// is currently doing.

const VoiceCtx = createContext(null);
export const useVoice = () => useContext(VoiceCtx);

export function VoiceProvider({ children }) {
  const store = useStore();
  const { settings } = store;

  const [phase, setPhase] = useState("idle");      // idle | listening | thinking | speaking | error
  const [mode, setMode] = useState("off");          // off | ambient | capturing
  const [interim, setInterim] = useState("");
  const [level, setLevel] = useState(0);
  const [micError, setMicError] = useState(null);

  const recRef = useRef(null);
  const meterRef = useRef(null);
  const abortRef = useRef(null);
  const busyRef = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /* ── speaking ────────────────────────────────────────────────────────── */
  const speak = useCallback((text) => {
    const s = settingsRef.current;
    if (!s.speak) return;
    speaker.say(text, { voiceURI: s.voiceURI, rate: s.rate, pitch: s.pitch });
  }, []);

  useEffect(() => {
    const offStart = speaker.onSpeechStart(() => setPhase("speaking"));
    const offEnd = speaker.onSpeechEnd(() => {
      // Only fall back to idle if no turn is still running — a long turn can
      // finish one sentence while the next tool call is still in flight.
      setPhase(busyRef.current ? "thinking" : "idle");
    });
    return () => { offStart(); offEnd(); };
  }, []);

  /* ── running a turn ──────────────────────────────────────────────────── */
  const send = useCallback(async (text, { speakReply = true } = {}) => {
    const utterance = String(text || "").trim();
    if (!utterance || busyRef.current) return;

    speaker.shutUp();
    busyRef.current = true;
    setPhase("thinking");
    setInterim("");

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const res = await runTurn({
      text: utterance,
      signal: ctrl.signal,
      onSpeakable: speakReply ? (sentence) => speak(sentence) : undefined,
    });

    abortRef.current = null;
    busyRef.current = false;

    if (res?.error) {
      setPhase("error");
      // The failure is already rendered in the turn with a retry attached;
      // clear the orb back to idle so it doesn't sit red forever.
      setTimeout(() => setPhase((p) => (p === "error" ? "idle" : p)), 2600);
    } else if (!speaker.isSpeaking()) {
      setPhase("idle");
    }
    return res;
  }, [speak]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    speaker.shutUp();
    recRef.current?.cancel();
    busyRef.current = false;
    setInterim("");
    setPhase("idle");
  }, []);

  /* ── the ear ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!sttSupported) return;
    const rec = createRecognizer({
      onInterim: setInterim,
      onCommit: (text) => {
        // Barge-in: if SYNC is mid-sentence when a command lands, it stops
        // talking and takes the new instruction. This is what makes the thing
        // feel like a conversation rather than a queue.
        speaker.shutUp();
        if (busyRef.current) abortRef.current?.abort();
        setTimeout(() => send(text), 0);
      },
      onState: (m) => {
        setMode(m);
        setPhase((p) => {
          if (m === "capturing") return "listening";
          if (p === "listening") return busyRef.current ? "thinking" : "idle";
          return p;
        });
      },
      onError: (e) => {
        setMicError(e.message);
        if (e.kind === "denied") setSettings({ ambient: false });
      },
      getWake: () => settingsRef.current.wakeWord || "sync",
    });
    recRef.current = rec;
    return () => { rec.destroy(); recRef.current = null; };
  }, [send]);

  // Ambient listening follows the setting, and only the setting — so the one
  // switch in the UI is genuinely the source of truth.
  useEffect(() => {
    const rec = recRef.current;
    if (!rec?.supported) return;
    if (settings.ambient) { setMicError(null); rec.start(); }
    else if (rec.listening()) rec.stop();
  }, [settings.ambient]);

  /* ── the meter ───────────────────────────────────────────────────────── */
  // Held only while the ear is actually open — wake-word listening, or the
  // length of one push-to-talk. An app you aren't talking to must not leave a
  // live-microphone indicator sitting in the browser chrome.
  const earOpen = settings.ambient || mode === "capturing";

  useEffect(() => {
    let cancelled = false;
    let raf = 0;

    const tick = () => {
      const m = meterRef.current;
      if (m) setLevel(m.level());
      raf = requestAnimationFrame(tick);
    };

    if (earOpen) {
      createMeter().then((m) => {
        if (cancelled) { m?.close(); return; }
        meterRef.current = m;
        if (m) raf = requestAnimationFrame(tick);
      });
    } else {
      meterRef.current?.close();
      meterRef.current = null;
      setLevel(0);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      meterRef.current?.close();
      meterRef.current = null;
    };
  }, [earOpen]);

  /* ── manual controls ─────────────────────────────────────────────────── */
  const talk = useCallback(() => {
    const rec = recRef.current;
    if (!rec?.supported) return false;
    speaker.shutUp();
    if (rec.mode() === "capturing") { rec.commitNow(); return true; }
    setMicError(null);
    rec.capture();
    return true;
  }, []);

  const holdStart = useCallback(() => {
    const rec = recRef.current;
    if (!rec?.supported || busyRef.current) return;
    speaker.shutUp();
    rec.capture();
  }, []);

  const holdEnd = useCallback(() => { recRef.current?.commitNow(); }, []);

  const toggleAmbient = useCallback(() => {
    setSettings({ ambient: !getState().settings.ambient });
  }, []);

  const value = useMemo(() => ({
    phase, mode, interim, level,
    micError, clearMicError: () => setMicError(null),
    sttSupported, ttsSupported: speaker.supported,
    busy: busyRef.current || phase === "thinking",
    send, stop, talk, holdStart, holdEnd, toggleAmbient, speak,
    shutUp: speaker.shutUp,
  }), [phase, mode, interim, level, micError, send, stop, talk, holdStart, holdEnd, toggleAmbient, speak]);

  return <VoiceCtx.Provider value={value}>{children}</VoiceCtx.Provider>;
}
