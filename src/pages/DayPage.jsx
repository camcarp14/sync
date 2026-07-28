import { useMemo, useRef, useState, useLayoutEffect } from "react";
import { useStore } from "../data/useStore.js";
import { commit, getState, undo } from "../data/store.js";
import { useVoice } from "../voice/VoiceProvider.jsx";
import { useNow } from "../ui/hooks.js";
import {
  PageHead, Card, Button, IconButton, Sheet, EmptyState, SectionHeader,
  Field, TextArea, useConfirm, useToast, StatTile, Num,
} from "../ui/kit.jsx";
import {
  IcPlus, IcSparkle, IcCheck, IcTrash, IcFocus, IcStop, IcChevronLeft, IcChevronRight,
} from "../ui/icons.jsx";
import {
  dayKey, addDays, dayLabel, minsOfDay, fmtTime, fmt24, fmtDur, fmtClock, parseTime,
} from "../lib/time.js";
import { BLOCK_KINDS, kindMeta } from "../data/seed.js";
import { describeGaps } from "../agent/tools.js";
import { id } from "../lib/id.js";

const HOUR_H = 64;

/* ── the running focus session ─────────────────────────────────────────────── */
function FocusBar({ focus, onEnd }) {
  const now = useNow(1000);
  const leftMs = Math.max(0, focus.endsAt - now);
  const total = focus.mins * 60000;
  const pct = total ? Math.max(0, Math.min(1, 1 - leftMs / total)) : 1;
  const R = 20;
  const C = 2 * Math.PI * R;
  const over = leftMs === 0;

  return (
    <div className="focusbar">
      <svg className="focusbar-ring" width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r={R} fill="none" stroke="var(--ink-a10)" strokeWidth="3" />
        <circle
          cx="24" cy="24" r={R} fill="none"
          stroke={over ? "var(--green)" : "var(--accent)"} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={`${C * pct} ${C}`}
          style={{ transform: "rotate(-90deg)", transformOrigin: "center", transition: "stroke-dasharray 1s linear" }}
        />
      </svg>
      <div className="focusbar-body">
        <span className="t-head" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{focus.label}</span>
        <span className="t-foot t-mono" style={{ color: over ? "var(--green)" : "var(--accent)" }}>
          {over ? "Time's up" : `${fmtClock(leftMs / 1000)} left`}
        </span>
      </div>
      <Button kind="quiet" size="sm" onClick={onEnd}><IcStop size={14} /> End</Button>
    </div>
  );
}

/* ── add / edit a block by hand ────────────────────────────────────────────── */
function BlockSheet({ block, day, onClose }) {
  const toast = useToast();
  const [confirmEl, confirm] = useConfirm();
  const editing = !!block;
  const [title, setTitle] = useState(block?.title || "");
  const [start, setStart] = useState(fmt24(block?.start ?? Math.min(23 * 60, Math.round(minsOfDay() / 15) * 15 + 15)));
  const [mins, setMins] = useState(String(block?.mins ?? 60));
  const [kind, setKind] = useState(block?.kind || "deep");
  const [note, setNote] = useState(block?.note || "");
  const [err, setErr] = useState("");

  const save = () => {
    const t = parseTime(start);
    if (!title.trim()) return setErr("Give it a title.");
    if (t == null) return setErr(`Couldn't read "${start}" as a time.`);
    const m = Math.max(5, Math.min(720, Math.round(Number(mins) || 30)));
    const next = {
      id: block?.id || id("b"),
      day: block?.day || day,
      title: title.trim(), start: t, mins: m, kind, note: note.trim(),
      status: block?.status || "planned",
      venture: block?.venture || null,
    };
    commit({
      action: editing ? "move_block" : "schedule_block",
      title: editing ? `Edited ${next.title}` : `Scheduled ${next.title}`,
      detail: `${dayLabel(next.day)} · ${fmtTime(next.start)}–${fmtTime(next.start + next.mins)}`,
      touches: ["blocks"],
      apply: (s) => ({ blocks: editing ? s.blocks.map((b) => (b.id === next.id ? next : b)) : [...s.blocks, next] }),
    });
    toast(editing ? "Updated" : "Scheduled", { action: () => undo(getState().ledger[getState().ledger.length - 1].id), actionLabel: "Undo" });
    onClose();
  };

  const remove = async () => {
    if (!(await confirm({ title: `Delete "${block.title}"?`, message: "It comes off the day entirely.", confirmLabel: "Delete", destructive: true }))) return;
    commit({
      action: "cancel_block", title: `Cleared ${block.title}`, detail: dayLabel(block.day),
      touches: ["blocks"], apply: (s) => ({ blocks: s.blocks.filter((b) => b.id !== block.id) }),
    });
    toast("Cleared");
    onClose();
  };

  return (
    <>
      {confirmEl}
      <Sheet
        onClose={onClose}
        title={editing ? "Edit block" : "New block"}
        footer={
          <>
            {editing && <Button kind="danger" size="lg" onClick={remove}><IcTrash size={16} /></Button>}
            <Button kind="quiet" size="lg" style={{ flex: 1 }} onClick={onClose}>Cancel</Button>
            <Button kind="primary" size="lg" style={{ flex: 1 }} onClick={save}>{editing ? "Save" : "Schedule"}</Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div className="t-label" style={{ marginBottom: 6 }}>What</div>
            <Field value={title} onChange={(e) => { setTitle(e.target.value); setErr(""); }} placeholder="Clarify outreach sequence" autoFocus />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div className="t-label" style={{ marginBottom: 6 }}>Starts</div>
              <Field value={start} onChange={(e) => { setStart(e.target.value); setErr(""); }} placeholder="09:00" inputMode="numeric" />
            </div>
            <div style={{ flex: 1 }}>
              <div className="t-label" style={{ marginBottom: 6 }}>Minutes</div>
              <Field value={mins} onChange={(e) => setMins(e.target.value)} placeholder="60" inputMode="numeric" />
            </div>
          </div>

          <div>
            <div className="t-label" style={{ marginBottom: 6 }}>Kind</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {BLOCK_KINDS.map((k) => (
                <button
                  key={k.key}
                  className={`pill${kind === k.key ? " active" : ""}`}
                  onClick={() => setKind(k.key)}
                >
                  <span className="dotstatus" style={{ background: k.tone, width: 6, height: 6 }} />
                  {k.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="t-label" style={{ marginBottom: 6 }}>What done looks like</div>
            <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — the outcome, not the activity." />
          </div>

          {err && <div className="t-foot" style={{ color: "var(--red)" }}>{err}</div>}
        </div>
      </Sheet>
    </>
  );
}

/* ── the page ──────────────────────────────────────────────────────────────── */
export default function DayPage() {
  const s = useStore();
  const voice = useVoice();
  const toast = useToast();
  const now = useNow(30000);
  const [day, setDay] = useState(dayKey());
  const [sheet, setSheet] = useState(null);   // {block} | {new:true}
  const scrollRef = useRef(null);
  const didScroll = useRef(false);

  const blocks = useMemo(
    () => s.blocks.filter((b) => b.day === day).sort((a, b) => a.start - b.start),
    [s.blocks, day]
  );

  const nowMins = minsOfDay(now);
  const isToday = day === dayKey();

  // The window the timeline draws: the working day, widened to hold anything
  // scheduled outside it, plus an hour of air at each end.
  const [fromH, toH] = useMemo(() => {
    let lo = Math.floor(s.profile.workStart / 60);
    let hi = Math.ceil(s.profile.workEnd / 60);
    for (const b of blocks) {
      lo = Math.min(lo, Math.floor(b.start / 60));
      hi = Math.max(hi, Math.ceil((b.start + b.mins) / 60));
    }
    if (isToday) { lo = Math.min(lo, Math.floor(nowMins / 60)); hi = Math.max(hi, Math.ceil(nowMins / 60) + 1); }
    return [Math.max(0, lo - 1), Math.min(24, hi + 1)];
  }, [blocks, s.profile.workStart, s.profile.workEnd, isToday, nowMins]);

  const hours = Array.from({ length: Math.max(1, toH - fromH) }, (_, i) => fromH + i);
  const yFor = (m) => ((m - fromH * 60) / 60) * HOUR_H;

  // Land on "now" the first time the page opens, without fighting the user
  // afterwards.
  useLayoutEffect(() => {
    if (didScroll.current || !isToday) return;
    const el = scrollRef.current;
    if (!el) return;
    didScroll.current = true;
    el.scrollTop = Math.max(0, yFor(nowMins) - el.clientHeight * 0.35);
  }, [isToday, nowMins, fromH]);

  const done = blocks.filter((b) => b.status === "done");
  const plannedMins = blocks.reduce((n, b) => n + b.mins, 0);
  const gaps = describeGaps(s, day, isToday ? Math.max(nowMins, s.profile.workStart) : s.profile.workStart, s.profile.workEnd);
  const freeMins = gaps.reduce((n, g) => n + g.mins, 0);

  const endFocus = () => {
    const f = s.focus;
    commit({
      action: "end_focus", title: `Focus ended — ${f.label}`,
      detail: fmtDur(Math.round((Date.now() - f.startedAt) / 60000)),
      touches: ["focus"], apply: () => ({ focus: null }),
    });
    toast("Focus ended");
  };

  const toggleDone = (b) => {
    const next = { ...b, status: b.status === "done" ? "planned" : "done", doneAt: Date.now() };
    commit({
      action: "complete_block",
      title: next.status === "done" ? `Done — ${b.title}` : `Reopened ${b.title}`,
      detail: `${fmtTime(b.start)}–${fmtTime(b.start + b.mins)}`,
      touches: ["blocks"],
      apply: (st) => ({ blocks: st.blocks.map((x) => (x.id === b.id ? next : x)) }),
    });
  };

  return (
    <>
      <PageHead
        title={dayLabel(day, { long: true })}
        sub={blocks.length
          ? `${blocks.length} block${blocks.length === 1 ? "" : "s"} · ${fmtDur(plannedMins)} committed · ${freeMins ? `${fmtDur(freeMins)} open` : "nothing open"}`
          : "Nothing on the board"}
        trailing={
          <>
            <IconButton label="Previous day" onClick={() => setDay((d) => addDays(d, -1))}><IcChevronLeft size={18} /></IconButton>
            {day !== dayKey() && <Button kind="quiet" size="sm" onClick={() => setDay(dayKey())}>Today</Button>}
            <IconButton label="Next day" onClick={() => setDay((d) => addDays(d, 1))}><IcChevronRight size={18} /></IconButton>
            <IconButton label="New block" onClick={() => setSheet({ new: true })}><IcPlus size={19} /></IconButton>
          </>
        }
      />

      <div className="content-scroll" ref={scrollRef}>
        <div className="content-max pagefade" key={day}>
          {s.focus && (
            <div style={{ marginBottom: 14 }}>
              <FocusBar focus={s.focus} onEnd={endFocus} />
            </div>
          )}

          {blocks.length === 0 ? (
            <Card pad="lg" style={{ marginTop: 8 }}>
              <EmptyState
                icon={<IcSparkle size={26} />}
                title={`${dayLabel(day)} is empty`}
                sub="Tell SYNC what the day holds and it'll lay the whole thing out — around your working hours, with slack left in it."
                action={
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                    <Button
                      kind="primary" size="md"
                      onClick={() => voice.send(`Plan ${day === dayKey() ? "today" : dayLabel(day).toLowerCase()} for me. Ask me nothing you can infer — lay out a realistic day and tell me what you assumed.`)}
                    >
                      <IcSparkle size={15} /> Have SYNC plan it
                    </Button>
                    <Button kind="quiet" size="md" onClick={() => setSheet({ new: true })}>
                      <IcPlus size={15} /> Add a block
                    </Button>
                  </div>
                }
              />
            </Card>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 16 }}>
                <StatTile value={<Num v={done.length} />} label={`of ${blocks.length} done`} />
                <StatTile value={fmtDur(plannedMins)} label="committed" />
                <StatTile value={freeMins ? fmtDur(freeMins) : "—"} label="still open" valueTone={freeMins ? undefined : "var(--faint)"} />
              </div>

              <div className="tl" style={{ ["--hour-h"]: `${HOUR_H}px` }}>
                {hours.map((h) => (
                  <div className="tl-hour" key={h}>
                    <span className="tl-hour-label">{fmt24(h * 60)}</span>
                  </div>
                ))}

                <div className="tl-blocks">
                  {blocks.map((b) => {
                    const meta = kindMeta(b.kind);
                    const live = isToday && nowMins >= b.start && nowMins < b.start + b.mins;
                    const h = Math.max(26, (b.mins / 60) * HOUR_H - 3);
                    return (
                      <button
                        key={b.id}
                        className={`tl-block${b.status === "done" ? " done" : ""}${live ? " now" : ""}${h < 40 ? " short" : ""}`}
                        style={{ top: yFor(b.start) + 1.5, height: h, ["--tone"]: meta.tone }}
                        onClick={() => setSheet({ block: b })}
                        title={`${fmtTime(b.start)}–${fmtTime(b.start + b.mins)} · ${b.title}`}
                      >
                        <span className="tl-block-t">{b.title}</span>
                        {h > 34 && (
                          <span className="tl-block-s">
                            {fmtTime(b.start)}–{fmtTime(b.start + b.mins)} · {meta.label}
                            {b.note ? ` · ${b.note}` : ""}
                          </span>
                        )}
                      </button>
                    );
                  })}

                  {isToday && nowMins >= fromH * 60 && nowMins <= toH * 60 && (
                    <div className="tl-now" style={{ top: yFor(nowMins) }}>
                      <span className="tl-now-label">{fmt24(nowMins)}</span>
                    </div>
                  )}
                </div>
              </div>

              <SectionHeader title="Close out" style={{ marginTop: 22 }} />
              <div className="cellgroup">
                {blocks.map((b) => (
                  <div className="cell has-leading" key={b.id}>
                    <button
                      className={`cell-leading tickbox${b.status === "done" ? " on" : ""}`}
                      onClick={() => toggleDone(b)}
                      aria-label={b.status === "done" ? `Reopen ${b.title}` : `Mark ${b.title} done`}
                    >
                      <IcCheck size={16} />
                    </button>
                    <span className="cell-body">
                      <span className="cell-title" style={b.status === "done" ? { color: "var(--faint)", textDecoration: "line-through" } : undefined}>
                        {b.title}
                      </span>
                      <span className="cell-sub">{fmtTime(b.start)}–{fmtTime(b.start + b.mins)}{b.outcome ? ` · ${b.outcome}` : ""}</span>
                    </span>
                    {!s.focus && b.status !== "done" && (
                      <button
                        className="act-undo"
                        onClick={() => voice.send(`Start a focus session on "${b.title}" for ${b.mins} minutes.`)}
                        title="Start a focus session on this"
                      >
                        <IcFocus size={13} /> Focus
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {gaps.length > 0 && (
                <>
                  <SectionHeader title="Open time" trailing={fmtDur(freeMins)} style={{ marginTop: 22 }} />
                  <Card pad="md">
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                      {gaps.map((g) => (
                        <button
                          key={g.from}
                          className="pill"
                          onClick={() => voice.send(`I have ${fmtDur(g.mins)} open from ${g.from} to ${g.to}. Put the best available thing in it and tell me why that one.`)}
                        >
                          {g.from}–{g.to} · {fmtDur(g.mins)}
                        </button>
                      ))}
                    </div>
                    <div className="t-foot" style={{ marginTop: 10 }}>Tap a gap and SYNC fills it from your queue.</div>
                  </Card>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {sheet && (
        <BlockSheet block={sheet.block} day={day} onClose={() => setSheet(null)} />
      )}
    </>
  );
}
