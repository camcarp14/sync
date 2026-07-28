import { useMemo, useState } from "react";
import { useStore } from "../data/useStore.js";
import { commit, getState, undo } from "../data/store.js";
import { useVoice } from "../voice/VoiceProvider.jsx";
import {
  PageHead, Card, Button, IconButton, Sheet, EmptyState, SectionHeader,
  Segmented, Field, TextArea, PillRow, useConfirm, useToast, StatTile, Num, Cell, CellGroup,
} from "../ui/kit.jsx";
import {
  IcPlus, IcCheck, IcTrash, IcSparkle, IcMail, IcQueue,
} from "../ui/icons.jsx";
import { dayKey, dayLabel, daysBetween, fmtDur, parseDay, ago } from "../lib/time.js";
import { PRIORITIES, priorityMeta, PRIORITY_RANK } from "../data/seed.js";
import { id } from "../lib/id.js";

/* ── task editor ───────────────────────────────────────────────────────────── */
function TaskSheet({ task, onClose }) {
  const s = useStore();
  const toast = useToast();
  const [confirmEl, confirm] = useConfirm();
  const editing = !!task;
  const [title, setTitle] = useState(task?.title || "");
  const [priority, setPriority] = useState(task?.priority || "normal");
  const [venture, setVenture] = useState(task?.venture || "");
  const [due, setDue] = useState(task?.due || "");
  const [estimate, setEstimate] = useState(task?.estimate ? String(task.estimate) : "");
  const [note, setNote] = useState(task?.note || "");
  const [err, setErr] = useState("");

  const save = () => {
    if (!title.trim()) return setErr("Give it a title.");
    const next = {
      id: task?.id || id("k"),
      title: title.trim(),
      priority,
      venture: venture || null,
      due: due ? (parseDay(due, dayKey()) || null) : null,
      estimate: Number(estimate) > 0 ? Math.round(Number(estimate)) : null,
      note: note.trim(),
      status: task?.status || "open",
      createdAt: task?.createdAt || Date.now(),
    };
    if (due && !next.due) return setErr(`Couldn't read "${due}" as a date. Try "friday", "tomorrow", or 2026-08-14.`);
    commit({
      action: editing ? "update_task" : "add_tasks",
      title: editing ? `Updated ${next.title}` : `Captured "${next.title}"`,
      detail: [priorityMeta(priority).label, next.due && `due ${dayLabel(next.due)}`].filter(Boolean).join(" · "),
      touches: ["tasks"],
      apply: (st) => ({ tasks: editing ? st.tasks.map((t) => (t.id === next.id ? next : t)) : [...st.tasks, next] }),
    });
    toast(editing ? "Updated" : "Captured", { action: () => undo(getState().ledger[getState().ledger.length - 1].id), actionLabel: "Undo" });
    onClose();
  };

  const drop = async () => {
    if (!(await confirm({ title: `Drop "${task.title}"?`, message: "It leaves the queue without being marked done.", confirmLabel: "Drop", destructive: true }))) return;
    commit({
      action: "update_task", title: `Dropped ${task.title}`, touches: ["tasks"],
      apply: (st) => ({ tasks: st.tasks.filter((t) => t.id !== task.id) }),
    });
    toast("Dropped");
    onClose();
  };

  return (
    <>
      {confirmEl}
      <Sheet
        onClose={onClose}
        title={editing ? "Edit task" : "New task"}
        footer={
          <>
            {editing && <Button kind="danger" size="lg" onClick={drop}><IcTrash size={16} /></Button>}
            <Button kind="quiet" size="lg" style={{ flex: 1 }} onClick={onClose}>Cancel</Button>
            <Button kind="primary" size="lg" style={{ flex: 1 }} onClick={save}>{editing ? "Save" : "Capture"}</Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div className="t-label" style={{ marginBottom: 6 }}>What</div>
            <Field value={title} onChange={(e) => { setTitle(e.target.value); setErr(""); }} placeholder="Send the med spa proposal" autoFocus />
          </div>

          <div>
            <div className="t-label" style={{ marginBottom: 6 }}>Priority</div>
            <Segmented options={PRIORITIES.map((p) => ({ key: p.key, label: p.label }))} value={priority} onChange={setPriority} />
          </div>

          {s.profile.ventures.length > 0 && (
            <div>
              <div className="t-label" style={{ marginBottom: 6 }}>Area</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                <button className={`pill${!venture ? " active" : ""}`} onClick={() => setVenture("")}>None</button>
                {s.profile.ventures.map((v) => (
                  <button key={v.key} className={`pill${venture === v.name ? " active" : ""}`} onClick={() => setVenture(v.name)}>
                    <span className="dotstatus" style={{ background: v.tone, width: 6, height: 6 }} />
                    {v.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div className="t-label" style={{ marginBottom: 6 }}>Due</div>
              <Field value={due} onChange={(e) => { setDue(e.target.value); setErr(""); }} placeholder="friday" />
            </div>
            <div style={{ flex: 1 }}>
              <div className="t-label" style={{ marginBottom: 6 }}>Minutes</div>
              <Field value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="45" inputMode="numeric" />
            </div>
          </div>

          <div>
            <div className="t-label" style={{ marginBottom: 6 }}>Notes</div>
            <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional." />
          </div>

          {err && <div className="t-foot" style={{ color: "var(--red)" }}>{err}</div>}
        </div>
      </Sheet>
    </>
  );
}

/* ── follow-up editor ──────────────────────────────────────────────────────── */
function FollowupSheet({ followup, onClose }) {
  const toast = useToast();
  const editing = !!followup;
  const [who, setWho] = useState(followup?.who || "");
  const [what, setWhat] = useState(followup?.what || "");
  const [due, setDue] = useState(followup?.due || "");
  const [channel, setChannel] = useState(followup?.channel || "");
  const [err, setErr] = useState("");

  const save = () => {
    if (!who.trim() || !what.trim()) return setErr("Both the person and what you're waiting on.");
    const next = {
      id: followup?.id || id("f"),
      who: who.trim(), what: what.trim(),
      due: due ? (parseDay(due, dayKey()) || null) : null,
      channel: channel.trim(),
      status: followup?.status || "open",
      createdAt: followup?.createdAt || Date.now(),
    };
    if (due && !next.due) return setErr(`Couldn't read "${due}" as a date.`);
    commit({
      action: "add_followup", title: `Waiting on ${next.who}`, detail: next.what,
      touches: ["followups"],
      apply: (st) => ({ followups: editing ? st.followups.map((f) => (f.id === next.id ? next : f)) : [...st.followups, next] }),
    });
    toast(editing ? "Updated" : "Tracking");
    onClose();
  };

  return (
    <Sheet
      onClose={onClose}
      title={editing ? "Edit follow-up" : "Waiting on"}
      footer={
        <>
          <Button kind="quiet" size="lg" style={{ flex: 1 }} onClick={onClose}>Cancel</Button>
          <Button kind="primary" size="lg" style={{ flex: 1 }} onClick={save}>Save</Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div className="t-label" style={{ marginBottom: 6 }}>Who</div>
          <Field value={who} onChange={(e) => { setWho(e.target.value); setErr(""); }} placeholder="Northside Dental" autoFocus />
        </div>
        <div>
          <div className="t-label" style={{ marginBottom: 6 }}>Waiting on</div>
          <Field value={what} onChange={(e) => { setWhat(e.target.value); setErr(""); }} placeholder="Signed proposal" />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div className="t-label" style={{ marginBottom: 6 }}>Chase on</div>
            <Field value={due} onChange={(e) => { setDue(e.target.value); setErr(""); }} placeholder="tuesday" />
          </div>
          <div style={{ flex: 1 }}>
            <div className="t-label" style={{ marginBottom: 6 }}>Channel</div>
            <Field value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="email" />
          </div>
        </div>
        {err && <div className="t-foot" style={{ color: "var(--red)" }}>{err}</div>}
      </div>
    </Sheet>
  );
}

/* ── the page ──────────────────────────────────────────────────────────────── */
export default function QueuePage() {
  const s = useStore();
  const voice = useVoice();
  const toast = useToast();
  const [tab, setTab] = useState("tasks");
  const [filter, setFilter] = useState("all");
  const [sheet, setSheet] = useState(null);
  const today = dayKey();

  const open = useMemo(
    () => s.tasks.filter((t) => t.status === "open").sort((a, b) => {
      const p = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
      if (p) return p;
      if (a.due && b.due) return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
      if (a.due) return -1;
      if (b.due) return 1;
      return a.createdAt - b.createdAt;
    }),
    [s.tasks]
  );

  const doneToday = s.tasks.filter((t) => t.status === "done" && t.doneAt && dayKey(t.doneAt) === today);
  const waiting = s.followups.filter((f) => f.status === "open");
  const overdue = open.filter((t) => t.due && t.due < today);
  const chase = waiting.filter((f) => f.due && f.due <= today);

  const filters = useMemo(() => {
    const areas = [...new Set(open.map((t) => t.venture).filter(Boolean))];
    return [
      { key: "all", label: "All", count: open.length },
      { key: "now", label: "Now", count: open.filter((t) => t.priority === "now").length },
      { key: "today", label: "Due today", count: open.filter((t) => t.due && t.due <= today).length },
      ...areas.map((a) => ({ key: `v:${a}`, label: a, count: open.filter((t) => t.venture === a).length })),
    ].filter((f) => f.key === "all" || f.count > 0);
  }, [open, today]);

  const shown = useMemo(() => {
    if (filter === "all") return open;
    if (filter === "now") return open.filter((t) => t.priority === "now");
    if (filter === "today") return open.filter((t) => t.due && t.due <= today);
    if (filter.startsWith("v:")) return open.filter((t) => t.venture === filter.slice(2));
    return open;
  }, [open, filter, today]);

  const complete = (t) => {
    commit({
      action: "update_task", title: `Done — ${t.title}`, touches: ["tasks"],
      apply: (st) => ({ tasks: st.tasks.map((x) => (x.id === t.id ? { ...x, status: "done", doneAt: Date.now() } : x)) }),
    });
    const entryId = getState().ledger[getState().ledger.length - 1].id;
    toast(`Done — ${t.title}`, { action: () => undo(entryId), actionLabel: "Undo" });
  };

  const closeFollowup = (f) => {
    commit({
      action: "resolve_followup", title: `Closed — ${f.who}`, detail: f.what, touches: ["followups"],
      apply: (st) => ({ followups: st.followups.map((x) => (x.id === f.id ? { ...x, status: "closed", closedAt: Date.now() } : x)) }),
    });
    const entryId = getState().ledger[getState().ledger.length - 1].id;
    toast(`Closed — ${f.who}`, { action: () => undo(entryId), actionLabel: "Undo" });
  };

  const dueLabel = (d) => {
    if (!d) return null;
    const delta = daysBetween(today, d);
    // Past about two months, "63d overdue" stops carrying information and
    // starts reading as a bug. Show the date and let it speak for itself.
    if (delta < -60) return { text: `due ${dayLabel(d)}`, tone: "var(--red)" };
    if (delta < 0) return { text: `${Math.abs(delta)}d overdue`, tone: "var(--red)" };
    if (delta === 0) return { text: "today", tone: "var(--amber)" };
    if (delta === 1) return { text: "tomorrow", tone: "var(--sub)" };
    return { text: dayLabel(d), tone: "var(--faint)" };
  };

  return (
    <>
      <PageHead
        title="Queue"
        sub={
          tab === "tasks"
            ? `${open.length} open${overdue.length ? ` · ${overdue.length} overdue` : ""}${doneToday.length ? ` · ${doneToday.length} closed today` : ""}`
            : `${waiting.length} outstanding${chase.length ? ` · ${chase.length} to chase` : ""}`
        }
        trailing={
          <IconButton
            label={tab === "tasks" ? "New task" : "New follow-up"}
            onClick={() => setSheet(tab === "tasks" ? { task: null } : { followup: null })}
          >
            <IcPlus size={19} />
          </IconButton>
        }
      />

      <div className="content-scroll">
        <div className="content-max">
          <Segmented
            options={[
              { key: "tasks", label: "Tasks", sub: String(open.length) },
              { key: "waiting", label: "Waiting on", sub: String(waiting.length) },
            ]}
            value={tab}
            onChange={setTab}
            style={{ marginBottom: 14 }}
          />

          <div className="pagefade" key={tab}>
            {tab === "tasks" ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
                  <StatTile value={<Num v={open.length} />} label="open" />
                  <StatTile value={<Num v={overdue.length} />} label="overdue" valueTone={overdue.length ? "var(--red)" : undefined} />
                  <StatTile value={<Num v={doneToday.length} />} label="closed today" valueTone={doneToday.length ? "var(--green)" : undefined} />
                </div>

                {filters.length > 1 && <PillRow options={filters} value={filter} onChange={setFilter} />}

                {shown.length === 0 ? (
                  <Card pad="lg">
                    <EmptyState
                      icon={<IcQueue size={26} />}
                      title={open.length ? "Nothing under this filter" : "The queue is clear"}
                      sub={open.length
                        ? "Try All — the rest of the queue is still there."
                        : "Say what's on your plate and SYNC takes all of it in one go. It'll set priorities honestly, which mostly means saying no to 'everything is urgent'."}
                      action={
                        open.length
                          ? <Button kind="quiet" size="sm" onClick={() => setFilter("all")}>Show all</Button>
                          : <Button kind="primary" size="md" onClick={() => voice.send("I'm going to list what's on my plate. Capture all of it and set honest priorities.")}>
                              <IcSparkle size={15} /> Brain-dump to SYNC
                            </Button>
                      }
                    />
                  </Card>
                ) : (
                  <CellGroup className="stagger">
                    {shown.map((t) => {
                      const p = priorityMeta(t.priority);
                      const d = dueLabel(t.due);
                      return (
                        <div className="cell has-leading tappable" key={t.id} onClick={() => setSheet({ task: t })}>
                          <button
                            className="cell-leading tickbox"
                            onClick={(e) => { e.stopPropagation(); complete(t); }}
                            aria-label={`Mark "${t.title}" done`}
                          >
                            <IcCheck size={16} />
                          </button>
                          <span className="cell-body">
                            <span className="cell-title">{t.title}</span>
                            <span className="cell-sub" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              {t.priority !== "normal" && (
                                <span style={{ color: p.tone, fontWeight: 600 }}>{p.label}</span>
                              )}
                              {t.venture && <span>{t.venture}</span>}
                              {t.estimate && <span>{fmtDur(t.estimate)}</span>}
                              {d && <span style={{ color: d.tone, fontWeight: d.tone === "var(--red)" ? 600 : 400 }}>{d.text}</span>}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </CellGroup>
                )}

                {doneToday.length > 0 && (
                  <>
                    <SectionHeader title="Closed today" trailing={String(doneToday.length)} style={{ marginTop: 22 }} />
                    <CellGroup>
                      {doneToday.slice().reverse().map((t) => (
                        <Cell
                          key={t.id}
                          done
                          leading={<IcCheck size={15} />}
                          leadingTone="var(--green)"
                          title={t.title}
                          sub={ago(t.doneAt)}
                        />
                      ))}
                    </CellGroup>
                  </>
                )}
              </>
            ) : (
              <>
                {waiting.length === 0 ? (
                  <Card pad="lg">
                    <EmptyState
                      icon={<IcMail size={26} />}
                      title="Nothing outstanding"
                      sub="This is the list that stops things quietly dying. Tell SYNC who owes you what and it'll surface them the day they go cold."
                      action={
                        <Button kind="primary" size="md" onClick={() => setSheet({ followup: null })}>
                          <IcPlus size={15} /> Track something
                        </Button>
                      }
                    />
                  </Card>
                ) : (
                  <CellGroup className="stagger">
                    {waiting.map((f) => {
                      const d = dueLabel(f.due);
                      return (
                        <div className="cell has-leading tappable" key={f.id} onClick={() => setSheet({ followup: f })}>
                          <button
                            className="cell-leading tickbox"
                            onClick={(e) => { e.stopPropagation(); closeFollowup(f); }}
                            aria-label={`Close the ${f.who} follow-up`}
                          >
                            <IcCheck size={16} />
                          </button>
                          <span className="cell-body">
                            <span className="cell-title">{f.who}</span>
                            <span className="cell-sub" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{f.what}</span>
                              {f.channel && <span style={{ color: "var(--faint)" }}>{f.channel}</span>}
                              {d && <span style={{ color: d.tone, fontWeight: d.tone === "var(--red)" ? 600 : 400 }}>{d.text}</span>}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </CellGroup>
                )}

                {chase.length > 0 && (
                  <Card pad="md" style={{ marginTop: 14 }}>
                    <div className="t-head" style={{ marginBottom: 4 }}>
                      {chase.length} {chase.length === 1 ? "chase is" : "chases are"} due
                    </div>
                    <div className="t-foot" style={{ marginBottom: 10 }}>
                      SYNC can write all of them at once and leave the drafts ready to send.
                    </div>
                    <Button
                      kind="tinted" size="sm"
                      onClick={() => voice.send(`Draft the chase messages for: ${chase.map((f) => `${f.who} (${f.what})`).join("; ")}. Short, warm, no apologising for following up. Save each as a draft.`)}
                    >
                      <IcSparkle size={14} /> Draft the chases
                    </Button>
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {sheet?.task !== undefined && <TaskSheet task={sheet.task} onClose={() => setSheet(null)} />}
      {sheet?.followup !== undefined && <FollowupSheet followup={sheet.followup} onClose={() => setSheet(null)} />}
    </>
  );
}
