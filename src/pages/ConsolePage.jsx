import { useEffect, useRef, useState, useLayoutEffect } from "react";
import VoiceOrb from "../voice/VoiceOrb.jsx";
import { useVoice } from "../voice/VoiceProvider.jsx";
import { useStore } from "../data/useStore.js";
import { undo, getState, setSettings } from "../data/store.js";
import { coldOpen } from "../agent/system.js";
import { Button, IconButton, Dot, useToast } from "../ui/kit.jsx";
import { useMedia } from "../ui/hooks.js";
import {
  IcSend, IcStop, IcMic, IcMicOff, IcSpeaker, IcSpeakerOff, IcCheck,
  IcAlert, IcSparkle,
} from "../ui/icons.jsx";

// ─── The Console ─────────────────────────────────────────────────────────────
// Where the day actually gets run. Three bands, top to bottom: the orb and
// whatever is being said right now; the transcript with an execution ledger
// under each reply; and the composer, because there are rooms you can't talk
// out loud in and the app has to keep working in them.

/* Light inline formatting only. SYNC is told not to write markdown — this
   exists so that when it slips, the reply reads as prose instead of asterisks. */
function Rich({ text }) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith("`") && p.endsWith("`") && p.length > 2) return <code key={i}>{p.slice(1, -1)}</code>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

function Act({ act, onUndo }) {
  const cls = act.status === "pending" ? "act pending" : act.status === "failed" ? "act failed" : "act";
  return (
    <div className={cls}>
      <span className="act-ic">
        {act.status === "pending"
          ? <span className="spinner" style={{ width: 13, height: 13, borderWidth: 1.75 }} />
          : act.status === "failed" ? <IcAlert size={15} /> : <IcCheck size={15} />}
      </span>
      <span className="act-body">
        <span className="act-title">{act.status === "pending" ? act.verb + "…" : act.title}</span>
        {act.detail && <span className="act-detail">{act.detail}</span>}
      </span>
      {act.status === "ok" && act.ledgerId && !act.readonly && (
        <button className="act-undo" onClick={() => onUndo(act.ledgerId)}>Undo</button>
      )}
    </div>
  );
}

function Turn({ turn, onUndo, onRetry }) {
  if (turn.role === "user") {
    return <div className="turn"><div className="turn-you">{turn.text}</div></div>;
  }
  const acts = turn.acts || [];
  return (
    <div className="turn">
      <div className="turn-sync">
        {acts.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {acts.map((a) => <Act key={a.id} act={a} onUndo={onUndo} />)}
          </div>
        )}

        {turn.text && <div className="say"><Rich text={turn.text} /></div>}

        {turn.status === "streaming" && !turn.text && (
          <span className="think" aria-label="Working"><i className="td" /><i className="td" /><i className="td" /></span>
        )}

        {turn.status === "stopped" && (
          <div className="turn-meta"><Dot tone="var(--faint)" size={5} /> Stopped</div>
        )}

        {turn.status === "error" && (
          <div className="act failed" style={{ alignItems: "center" }}>
            <span className="act-ic"><IcAlert size={15} /></span>
            <span className="act-body">
              <span className="act-title">{turn.error}</span>
            </span>
            <button className="act-undo" onClick={onRetry} style={{ color: "var(--red)" }}>Retry</button>
          </div>
        )}
      </div>
    </div>
  );
}

// Openers that send immediately, plus one that drops into the composer because
// the useful half of it is whatever you type next.
const OPENERS = [
  { label: "Plan my day", say: "Plan my day around what's already booked. Tell me what you assumed." },
  { label: "What am I not doing?", say: "What's the most important thing I'm not doing right now, and why that one?" },
  { label: "What's gone quiet?", say: "What am I waiting on that's gone quiet? Include anything past its chase date." },
  { label: "Take a note…", fill: "Take a note — " },
];

export default function ConsolePage() {
  const s = useStore();
  const voice = useVoice();
  const toast = useToast();
  // A canvas needs real pixels, so the breakpoint has to reach JS. On a phone
  // the orb was eating a third of the screen before the first line of content.
  const phone = useMedia("(max-width: 760px)");
  const orbSize = phone ? 116 : 148;
  const [text, setText] = useState("");
  const streamRef = useRef(null);
  const taRef = useRef(null);
  const [pinned, setPinned] = useState(true);

  const turns = s.turns;
  const last = turns[turns.length - 1];
  const lastUser = [...turns].reverse().find((t) => t.role === "user");

  /* Follow the stream only while the user is already at the bottom — reading
     back through the day must not be yanked away by a new reply. */
  const onScroll = () => {
    const el = streamRef.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 90);
  };

  useLayoutEffect(() => {
    // Nothing to follow before the first turn — and on a short screen the
    // opening card is taller than the stream, so scrolling to the "bottom"
    // of it just guillotines the greeting.
    if (!pinned || turns.length === 0) return;
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, pinned, last?.text, last?.acts?.length]);

  const submit = () => {
    const t = text.trim();
    if (!t || voice.busy) return;
    setText("");
    voice.send(t);
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  // The textarea grows with its content, up to the cap set in CSS.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = Math.min(168, ta.scrollHeight) + "px";
  }, [text]);

  const handleUndo = (ledgerId) => {
    const entry = getState().ledger.find((e) => e.id === ledgerId);
    if (undo(ledgerId)) toast(`Undone — ${entry?.title || "action"}`);
    else toast("Already undone", { err: true });
  };

  const retry = () => { if (lastUser) voice.send(lastUser.text); };

  const orbState =
    voice.phase === "listening" ? "listening" :
    voice.phase === "thinking" ? "thinking" :
    voice.phase === "speaking" ? "speaking" :
    voice.phase === "error" ? "error" : "idle";

  const caption =
    voice.interim ? voice.interim :
    voice.phase === "listening" ? "Listening…" :
    voice.phase === "thinking" ? "Working on it" :
    voice.phase === "speaking" ? "" :
    s.settings.ambient ? `Say "${s.settings.wakeWord}" — or tap` : "Tap to talk";

  return (
    <div className="console">
      {/* ── the stage ─────────────────────────────────────────────────── */}
      <div className="stage">
        {/* In flow, not absolutely positioned: on an installed PWA the stage
            carries the status-bar inset as padding, and anything pinned to its
            border box would sit underneath the clock. */}
        <div className="console-bar">
          <IconButton
            label={s.settings.speak ? "Mute SYNC" : "Let SYNC speak"}
            on={s.settings.speak}
            onClick={() => { setSettings({ speak: !s.settings.speak }); if (s.settings.speak) voice.shutUp(); }}
          >
            {s.settings.speak ? <IcSpeaker size={17} /> : <IcSpeakerOff size={17} />}
          </IconButton>
          <IconButton
            label={s.settings.ambient ? "Stop listening" : "Listen for the wake word"}
            on={s.settings.ambient}
            onClick={voice.toggleAmbient}
            disabled={!voice.sttSupported}
          >
            {s.settings.ambient ? <IcMic size={17} /> : <IcMicOff size={17} />}
          </IconButton>
        </div>

        <VoiceOrb
          size={orbSize}
          state={orbState}
          level={voice.level}
          onClick={voice.busy ? voice.stop : voice.talk}
          disabled={!voice.sttSupported && !voice.busy}
          label={voice.busy ? "Stop" : "Talk to SYNC"}
        />

        <div className="utterance">
          {voice.interim
            ? <span className="u-text interim">{voice.interim}</span>
            : <span className="u-hint">{caption}</span>}
        </div>

        {voice.micError && (
          <div className="act failed" style={{ maxWidth: 520 }}>
            <span className="act-ic"><IcAlert size={15} /></span>
            <span className="act-body"><span className="act-detail">{voice.micError}</span></span>
            <button className="act-undo" onClick={voice.clearMicError}>Dismiss</button>
          </div>
        )}

        {!voice.sttSupported && (
          <div className="act" style={{ maxWidth: 520 }}>
            <span className="act-ic" style={{ color: "var(--amber)" }}><IcAlert size={15} /></span>
            <span className="act-body">
              <span className="act-detail">
                This browser has no speech recognition. Everything still works by typing — Chrome, Edge and Safari give you the voice loop.
              </span>
            </span>
          </div>
        )}
      </div>

      {/* ── the transcript ────────────────────────────────────────────── */}
      <div className="stream scroll-thin" ref={streamRef} onScroll={onScroll}>
        {/* A screen reader hears the reply as it lands, the same moment the
            speakers do — the two channels stay in step. */}
        <div className="stream-inner" role="log" aria-live="polite" aria-relevant="additions text">
          {turns.length === 0 ? (
            <div style={{ paddingTop: 6 }}>
              <div className="card pad-lg" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="t-head">{coldOpen(s)}</div>
                <div className="t-foot">
                  Say it or type it. SYNC does the thing — it doesn't hand you a checklist. Everything it does shows up
                  below with an Undo next to it.
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
                  {OPENERS.map((o) => (
                    <button
                      key={o.label}
                      className="pill"
                      onClick={() => {
                        if (o.fill) { setText(o.fill); taRef.current?.focus(); }
                        else voice.send(o.say);
                      }}
                    >
                      <IcSparkle size={13} /> {o.label}
                    </button>
                  ))}
                </div>
              </div>

              {!s.settings.apiKey && (
                <div className="act" style={{ marginTop: 12 }}>
                  <span className="act-ic" style={{ color: "var(--amber)" }}><IcAlert size={15} /></span>
                  <span className="act-body">
                    <span className="act-title">No API key yet</span>
                    <span className="act-detail">
                      SYNC needs an Anthropic key to think. Add one in Settings — it stays in this browser and is never
                      included in an export.
                    </span>
                  </span>
                </div>
              )}
            </div>
          ) : (
            turns.map((t) => <Turn key={t.id} turn={t} onUndo={handleUndo} onRetry={retry} />)
          )}
        </div>
      </div>

      {/* ── the composer ──────────────────────────────────────────────── */}
      <div className="composer">
        <div className="composer-inner">
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={voice.busy ? "SYNC is working…" : "Tell SYNC what to do"}
            aria-label="Message SYNC"
          />
          {voice.busy ? (
            <Button kind="quiet" size="md" onClick={voice.stop} title="Stop" style={{ width: 46, padding: 0, flex: "none" }}>
              <IcStop size={17} />
            </Button>
          ) : (
            <Button
              kind={text.trim() ? "primary" : "quiet"}
              size="md"
              onClick={submit}
              disabled={!text.trim()}
              title="Send"
              style={{ width: 46, padding: 0, flex: "none" }}
            >
              <IcSend size={17} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
