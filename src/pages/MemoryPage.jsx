import { useMemo, useState } from "react";
import { useStore } from "../data/useStore.js";
import { commit, getState, undo, setProfile } from "../data/store.js";
import { useVoice } from "../voice/VoiceProvider.jsx";
import {
  PageHead, Card, Button, IconButton, Sheet, EmptyState, SectionHeader,
  Segmented, Field, TextArea, useConfirm, useToast, Cell, CellGroup, StatTile, Num,
} from "../ui/kit.jsx";
import {
  IcPlus, IcMemory, IcTrash, IcSparkle, IcNote, IcFlag, IcBolt, IcUndo, IcCheck,
} from "../ui/icons.jsx";
import { ago, dayLabel } from "../lib/time.js";
import { id } from "../lib/id.js";

// ─── Memory ──────────────────────────────────────────────────────────────────
// Everything SYNC carries between conversations, in one place you can edit.
// The point of showing it is trust: an assistant that remembers things you
// can't see or delete is one you eventually stop telling things to.

function AddSheet({ kind, onClose }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const label = kind === "memory" ? "Fact" : kind === "directive" ? "Directive" : "Note";

  const save = () => {
    const t = text.trim();
    if (!t) return;
    if (kind === "memory") {
      commit({
        action: "remember", title: "Remembered", detail: t, touches: ["memory"],
        apply: (s) => ({ memory: [...s.memory, { id: id("m"), fact: t, createdAt: Date.now() }] }),
      });
    } else if (kind === "directive") {
      commit({
        action: "update_profile", title: "Directive added", detail: t, touches: ["profile"],
        apply: (s) => ({ profile: { ...s.profile, directives: [...s.profile.directives, t] } }),
      });
    } else {
      commit({
        action: "capture_note", title: "Noted", detail: t, touches: ["notes"],
        apply: (s) => ({ notes: [...s.notes, { id: id("n"), text: t, tags: [], createdAt: Date.now() }] }),
      });
    }
    toast(`${label} saved`, { action: () => undo(getState().ledger[getState().ledger.length - 1].id), actionLabel: "Undo" });
    onClose();
  };

  return (
    <Sheet
      onClose={onClose}
      title={`New ${label.toLowerCase()}`}
      footer={
        <>
          <Button kind="quiet" size="lg" style={{ flex: 1 }} onClick={onClose}>Cancel</Button>
          <Button kind="primary" size="lg" style={{ flex: 1 }} onClick={save} disabled={!text.trim()}>Save</Button>
        </>
      }
    >
      <div className="t-foot" style={{ marginBottom: 8 }}>
        {kind === "memory" && "One sentence, stated as fact. This is loaded into SYNC's context on every turn, so keep it true and worth carrying."}
        {kind === "directive" && "A standing rule for how SYNC behaves. It reads these as orders, every single turn."}
        {kind === "note" && "Anything worth keeping that isn't a task."}
      </div>
      <TextArea rows={4} value={text} onChange={(e) => setText(e.target.value)} autoFocus
        placeholder={
          kind === "memory" ? "The Northside retainer renews on the first of every quarter."
          : kind === "directive" ? "Never schedule anything before 8am."
          : "Something worth remembering."
        }
      />
    </Sheet>
  );
}

function VentureSheet({ venture, onClose }) {
  const s = useStore();
  const toast = useToast();
  const [confirmEl, confirm] = useConfirm();
  const editing = !!venture;
  const [name, setName] = useState(venture?.name || "");
  const [note, setNote] = useState(venture?.note || "");
  const TONES = ["var(--accent)", "var(--green)", "var(--amber)", "var(--purple)", "var(--pink)"];

  const save = () => {
    if (!name.trim()) return;
    const next = { key: venture?.key || id("v"), name: name.trim(), note: note.trim(), tone: venture?.tone || TONES[s.profile.ventures.length % TONES.length] };
    setProfile({ ventures: editing ? s.profile.ventures.map((v) => (v.key === next.key ? next : v)) : [...s.profile.ventures, next] });
    toast(editing ? "Updated" : "Added");
    onClose();
  };

  const remove = async () => {
    if (!(await confirm({ title: `Remove "${venture.name}"?`, message: "Tasks already tagged with it keep the label.", confirmLabel: "Remove", destructive: true }))) return;
    setProfile({ ventures: s.profile.ventures.filter((v) => v.key !== venture.key) });
    toast("Removed");
    onClose();
  };

  return (
    <>
      {confirmEl}
      <Sheet
        onClose={onClose}
        title={editing ? "Edit area" : "New area"}
        footer={
          <>
            {editing && <Button kind="danger" size="lg" onClick={remove}><IcTrash size={16} /></Button>}
            <Button kind="quiet" size="lg" style={{ flex: 1 }} onClick={onClose}>Cancel</Button>
            <Button kind="primary" size="lg" style={{ flex: 1 }} onClick={save} disabled={!name.trim()}>Save</Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div className="t-label" style={{ marginBottom: 6 }}>Name</div>
            <Field value={name} onChange={(e) => setName(e.target.value)} placeholder="Clarify Paid Search" autoFocus />
          </div>
          <div>
            <div className="t-label" style={{ marginBottom: 6 }}>What it is</div>
            <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you're actually trying to do here — SYNC reads this every turn." />
          </div>
        </div>
      </Sheet>
    </>
  );
}

export default function MemoryPage() {
  const s = useStore();
  const voice = useVoice();
  const toast = useToast();
  const [confirmEl, confirm] = useConfirm();
  const [tab, setTab] = useState("knows");
  const [sheet, setSheet] = useState(null);

  const ledger = useMemo(() => [...s.ledger].reverse().slice(0, 120), [s.ledger]);
  const notes = useMemo(() => [...s.notes].reverse(), [s.notes]);
  const decisions = useMemo(() => [...s.decisions].reverse(), [s.decisions]);

  const forget = async (m) => {
    if (!(await confirm({ title: "Forget this?", message: m.fact, confirmLabel: "Forget", destructive: true }))) return;
    commit({
      action: "forget", title: "Forgot", detail: m.fact, touches: ["memory"],
      apply: (st) => ({ memory: st.memory.filter((x) => x.id !== m.id) }),
    });
    toast("Forgotten", { action: () => undo(getState().ledger[getState().ledger.length - 1].id), actionLabel: "Undo" });
  };

  const dropDirective = (d) => {
    commit({
      action: "update_profile", title: "Directive removed", detail: d, touches: ["profile"],
      apply: (st) => ({ profile: { ...st.profile, directives: st.profile.directives.filter((x) => x !== d) } }),
    });
    toast("Removed", { action: () => undo(getState().ledger[getState().ledger.length - 1].id), actionLabel: "Undo" });
  };

  const dropNote = (n) => {
    commit({
      action: "delete_note", title: "Note deleted", detail: n.text.slice(0, 60), touches: ["notes"],
      apply: (st) => ({ notes: st.notes.filter((x) => x.id !== n.id) }),
    });
    toast("Deleted", { action: () => undo(getState().ledger[getState().ledger.length - 1].id), actionLabel: "Undo" });
  };

  return (
    <>
      {confirmEl}
      <PageHead
        title="Memory"
        sub={`${s.memory.length} fact${s.memory.length === 1 ? "" : "s"} · ${s.profile.directives.length} directive${s.profile.directives.length === 1 ? "" : "s"} · ${s.ledger.length} action${s.ledger.length === 1 ? "" : "s"} on record`}
        trailing={
          tab === "knows"
            ? <IconButton label="Remember something" onClick={() => setSheet({ kind: "memory" })}><IcPlus size={19} /></IconButton>
            : tab === "notes"
              ? <IconButton label="New note" onClick={() => setSheet({ kind: "note" })}><IcPlus size={19} /></IconButton>
              : null
        }
      />

      <div className="content-scroll">
        <div className="content-max">
          <Segmented
            options={[
              { key: "knows", label: "Knows", sub: String(s.memory.length) },
              { key: "notes", label: "Notes", sub: String(notes.length) },
              { key: "ledger", label: "Activity", sub: String(s.ledger.length) },
            ]}
            value={tab}
            onChange={setTab}
            style={{ marginBottom: 14 }}
          />

          <div className="pagefade" key={tab}>
            {tab === "knows" && (
              <>
                <SectionHeader title="Standing directives" trailing="Add" onTrailing={() => setSheet({ kind: "directive" })} />
                {s.profile.directives.length === 0 ? (
                  <Card pad="md">
                    <div className="t-foot">
                      No directives yet. These are rules SYNC follows every single turn — "never book before 8am",
                      "pressure-test, don't validate". Say one out loud and it stores it itself.
                    </div>
                  </Card>
                ) : (
                  <CellGroup>
                    {s.profile.directives.map((d) => (
                      <Cell
                        key={d}
                        leading={<IcFlag size={15} />}
                        leadingTone="var(--amber)"
                        title={d}
                        titleStyle={{ whiteSpace: "normal" }}
                        trailing={<IconButton label="Remove" onClick={() => dropDirective(d)}><IcTrash size={15} /></IconButton>}
                      />
                    ))}
                  </CellGroup>
                )}

                <SectionHeader title="Areas" trailing="Add" onTrailing={() => setSheet({ venture: null })} style={{ marginTop: 22 }} />
                {s.profile.ventures.length === 0 ? (
                  <Card pad="md"><div className="t-foot">No areas yet. These are the things you're actually running — SYNC uses them to sort your queue and to know what "outreach" means to you.</div></Card>
                ) : (
                  <CellGroup>
                    {s.profile.ventures.map((v) => (
                      <Cell
                        key={v.key}
                        leading={<span className="dotstatus" style={{ background: v.tone, width: 9, height: 9 }} />}
                        title={v.name}
                        sub={v.note}
                        chevron
                        onClick={() => setSheet({ venture: v })}
                      />
                    ))}
                  </CellGroup>
                )}

                <SectionHeader title="Facts SYNC carries" trailing={String(s.memory.length)} style={{ marginTop: 22 }} />
                {s.memory.length === 0 ? (
                  <Card pad="lg">
                    <EmptyState
                      icon={<IcMemory size={26} />}
                      title="Nothing committed yet"
                      sub="Anything you tell SYNC that stays true — a renewal date, how someone likes to be contacted, a number you keep quoting — it files here and recalls without being asked."
                      action={<Button kind="quiet" size="sm" onClick={() => setSheet({ kind: "memory" })}><IcPlus size={14} /> Add a fact</Button>}
                    />
                  </Card>
                ) : (
                  <CellGroup className="stagger">
                    {s.memory.slice().reverse().map((m) => (
                      <Cell
                        key={m.id}
                        leading={<IcMemory size={15} />}
                        leadingTone="var(--accent)"
                        title={m.fact}
                        titleStyle={{ whiteSpace: "normal" }}
                        sub={ago(m.createdAt)}
                        trailing={<IconButton label="Forget" onClick={() => forget(m)}><IcTrash size={15} /></IconButton>}
                      />
                    ))}
                  </CellGroup>
                )}

                {decisions.length > 0 && (
                  <>
                    <SectionHeader title="Decisions on record" trailing={String(decisions.length)} style={{ marginTop: 22 }} />
                    <CellGroup>
                      {decisions.slice(0, 20).map((d) => (
                        <Cell
                          key={d.id}
                          leading={<IcBolt size={15} />}
                          leadingTone="var(--purple)"
                          title={d.decision}
                          titleStyle={{ whiteSpace: "normal" }}
                          sub={[d.rationale, d.revisit && `revisit ${dayLabel(d.revisit)}`].filter(Boolean).join(" · ")}
                        />
                      ))}
                    </CellGroup>
                  </>
                )}
              </>
            )}

            {tab === "notes" && (
              notes.length === 0 ? (
                <Card pad="lg">
                  <EmptyState
                    icon={<IcNote size={26} />}
                    title="No notes yet"
                    sub="Say 'take a note' and keep talking. SYNC writes it verbatim rather than summarising it into uselessness."
                    action={<Button kind="primary" size="md" onClick={() => voice.send("Take a note.")}><IcSparkle size={15} /> Dictate one</Button>}
                  />
                </Card>
              ) : (
                <CellGroup className="stagger">
                  {notes.map((n) => (
                    <Cell
                      key={n.id}
                      leading={<IcNote size={15} />}
                      leadingTone="var(--faint)"
                      title={n.text}
                      titleStyle={{ whiteSpace: "normal" }}
                      sub={[ago(n.createdAt), ...(n.tags || [])].join(" · ")}
                      trailing={<IconButton label="Delete" onClick={() => dropNote(n)}><IcTrash size={15} /></IconButton>}
                    />
                  ))}
                </CellGroup>
              )
            )}

            {tab === "ledger" && (
              ledger.length === 0 ? (
                <Card pad="lg">
                  <EmptyState
                    icon={<IcCheck size={26} />}
                    title="Nothing has happened yet"
                    sub="Every action SYNC takes lands here — what it was, when, and a way to reverse it. It's the receipt for letting something run your day."
                  />
                </Card>
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
                    <StatTile value={<Num v={s.ledger.length} />} label="actions taken" />
                    <StatTile value={<Num v={s.usage.calls} />} label="model calls" />
                    <StatTile value={`$${s.usage.cost.toFixed(2)}`} label="est. spend" />
                  </div>
                  <CellGroup className="stagger">
                    {ledger.map((e) => (
                      <Cell
                        key={e.id}
                        leading={e.undone ? <IcUndo size={15} /> : <IcCheck size={15} />}
                        leadingTone={e.undone ? "var(--faint)" : "var(--green)"}
                        title={e.title}
                        titleStyle={{ whiteSpace: "normal", ...(e.undone ? { color: "var(--faint)", textDecoration: "line-through" } : {}) }}
                        sub={[ago(e.at), e.detail].filter(Boolean).join(" · ")}
                        trailing={
                          e.undo && !e.undone
                            ? <button className="act-undo" onClick={() => { undo(e.id); toast("Undone"); }}>Undo</button>
                            : null
                        }
                      />
                    ))}
                  </CellGroup>
                </>
              )
            )}
          </div>
        </div>
      </div>

      {sheet?.kind && <AddSheet kind={sheet.kind} onClose={() => setSheet(null)} />}
      {sheet?.venture !== undefined && <VentureSheet venture={sheet.venture} onClose={() => setSheet(null)} />}
    </>
  );
}
