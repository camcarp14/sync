// ─── The SYNC kit — the only components anyone reaches for ────────────────────
// One material (Card), one list grammar (CellGroup/Cell), one number voice
// (StatTile/Num), one set of controls. Styles live in design/components.css;
// these own structure and behaviour only.

import { useState, useRef, useEffect, useCallback, forwardRef, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { IcChevronRight, IcChevronDown, IcClose, IcCheck } from "./icons.jsx";
import { useTween } from "./hooks.js";

/* ── surfaces ──────────────────────────────────────────────────────────────── */
export function Card({ pad = "md", pressable, onClick, className = "", style, children, ...rest }) {
  const cls = `card pad-${pad}${pressable || onClick ? " pressable" : ""}${className ? " " + className : ""}`;
  return (
    <div
      className={cls} style={style} onClick={onClick}
      {...(onClick
        ? { role: "button", tabIndex: 0, onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } } }
        : {})}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CollapsibleCard({ title, leading, trailing, pad = "md", collapsed, onToggle, children, style, className }) {
  return (
    <Card pad={pad} className={className} style={{ minWidth: 0, ...style }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: collapsed ? 0 : 10 }}>
        <button
          type="button" onClick={onToggle} aria-expanded={!collapsed}
          style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1, background: "none", border: "none", padding: "4px 0", margin: "-4px 0", font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer" }}
        >
          {leading}
          <span className="t-head" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
          <IcChevronDown size={13} style={{ flex: "none", color: "var(--faint)", transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform var(--dur-2) var(--ease-out)" }} />
        </button>
        {!collapsed && trailing != null && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flex: "none" }}>{trailing}</span>
        )}
      </div>
      <Expand open={!collapsed}>{children}</Expand>
    </Card>
  );
}

// grid-rows 0fr→1fr: animates height:auto with zero measuring and zero jank
export function Expand({ open, children }) {
  return <div className={`expand${open ? " open" : ""}`}><div>{children}</div></div>;
}

export function SectionHeader({ title, trailing, onTrailing, style }) {
  return (
    <div className="sec-head" style={style}>
      <span className="t-label">{title}</span>
      {trailing != null && (
        onTrailing
          ? <button className="sec-link" onClick={onTrailing}>{trailing}</button>
          : <span className="t-cap" style={{ color: "var(--faint)" }}>{trailing}</span>
      )}
    </div>
  );
}

/* ── lists ─────────────────────────────────────────────────────────────────── */
export function CellGroup({ children, style, className = "" }) {
  return <div className={`cellgroup${className ? " " + className : ""}`} style={style}>{children}</div>;
}

export function Cell({ leading, leadingTone, title, sub, value, trailing, chevron, onClick, destructive, done, style, titleStyle }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      className={`cell${onClick ? " tappable" : ""}${leading ? " has-leading" : ""}${destructive ? " destructive" : ""}${done ? " done" : ""}`}
      onClick={onClick} style={style} type={onClick ? "button" : undefined}
    >
      {leading && (
        <span
          className="cell-leading"
          style={leadingTone
            ? { background: `color-mix(in srgb, ${leadingTone} 14%, transparent)`, color: leadingTone }
            : { color: "var(--sub)" }}
        >
          {leading}
        </span>
      )}
      <span className="cell-body">
        <span className="cell-title" style={titleStyle}>{title}</span>
        {sub != null && <span className="cell-sub">{sub}</span>}
      </span>
      {value != null && <span className="cell-value">{value}</span>}
      {trailing}
      {chevron && <span className="cell-chevron"><IcChevronRight size={16} /></span>}
    </Tag>
  );
}

/* ── numbers — they travel to their value, never snap ──────────────────────── */
export function Num({ v, f = (x) => Math.round(x).toLocaleString() }) {
  const shown = useTween(typeof v === "number" ? v : null);
  return shown == null ? <>—</> : <>{f(shown)}</>;
}

export function StatTile({ value, label, delta, deltaTone = "var(--green)", valueTone, onClick, selected, onCanvas, style }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      className={`stattile${onClick ? " tappable" : ""}${selected ? " selected" : ""}${onCanvas ? " on-canvas" : ""}`}
      onClick={onClick} style={style} type={onClick ? "button" : undefined}
    >
      <span className="stattile-value" style={valueTone ? { color: valueTone } : undefined}>{value}</span>
      <span className="stattile-label" style={selected ? { color: "var(--accent)" } : undefined}>{label}</span>
      {delta != null && <span className="stattile-delta" style={{ color: deltaTone }}>{delta}</span>}
    </Tag>
  );
}

/* ── status vocabulary — dot + quiet text, never a filled badge ─────────────── */
const STATE_META = {
  idle: { tone: "var(--faint)", label: "Idle" },
  live: { tone: "var(--green)", label: "Live", pulse: true },
  listening: { tone: "var(--accent)", label: "Listening", pulse: true },
  thinking: { tone: "var(--accent)", label: "Working", pulse: true },
  speaking: { tone: "var(--purple)", label: "Speaking", pulse: true },
  waiting: { tone: "var(--amber)", label: "Needs a key" },
  error: { tone: "var(--red)", label: "Error" },
  offline: { tone: "var(--faint)", label: "Offline" },
};

export function Dot({ tone = "var(--faint)", pulse, size = 7 }) {
  return <span className={`dotstatus${pulse ? " pulse" : ""}`} style={{ background: tone, width: size, height: size }} />;
}

export function Status({ state = "idle", label, title }) {
  const m = STATE_META[state] || STATE_META.idle;
  return (
    <span title={title} style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "none" }}>
      <Dot tone={m.tone} pulse={m.pulse} size={6} />
      <span className="t-cap" style={{ color: m.tone, fontWeight: 600 }}>{label || m.label}</span>
    </span>
  );
}

/* ── controls ──────────────────────────────────────────────────────────────── */
export function Button({ kind = "quiet", size = "md", full, disabled, onClick, children, style, type = "button", title, ...rest }) {
  return (
    <button type={type} className={`btn ${kind} ${size}${full ? " full" : ""}`} disabled={disabled} onClick={onClick} style={style} title={title} {...rest}>
      {children}
    </button>
  );
}

export function IconButton({ on, label, onClick, disabled, children, style, ...rest }) {
  return (
    <button
      type="button" className={`icon-btn${on ? " on" : ""}`} onClick={onClick}
      disabled={disabled} aria-label={label} title={label} style={style} {...rest}
    >
      {children}
    </button>
  );
}

export function Pill({ active, onClick, children, style, ...rest }) {
  return <button type="button" className={`pill${active ? " active" : ""}`} onClick={onClick} style={style} {...rest}>{children}</button>;
}

export function PillRow({ options, value, onChange, style }) {
  const rowRef = useRef(null);
  useEffect(() => {
    const el = rowRef.current?.querySelector(".pill.active");
    if (el) el.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [value]);
  return (
    <div className="pillrow" ref={rowRef} style={style}>
      {options.map((o) => (
        <Pill key={o.key} active={value === o.key} onClick={() => onChange(o.key)}>
          {o.label}
          {o.count != null && <span className="t-num" style={{ opacity: 0.65, fontSize: 12 }}>{o.count}</span>}
        </Pill>
      ))}
    </div>
  );
}

export function Segmented({ options, value, onChange, style }) {
  const idx = Math.max(0, options.findIndex((o) => (o.key ?? o) === value));
  const w = 100 / options.length;
  return (
    <div className="seg" style={style}>
      <span className="seg-thumb" style={{ left: `calc(${idx * w}% + 2px)`, width: `calc(${w}% - 4px)` }} />
      {options.map((o) => {
        const k = o.key ?? o;
        const active = k === value;
        return (
          <button key={k} type="button" className={`seg-opt${active ? " active" : ""}`} onClick={() => onChange(k)} aria-pressed={active}>
            <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, minWidth: 0 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{o.label ?? k}</span>
              {o.sub && <span className="t-num" style={{ fontSize: 10.5, color: "var(--sub)" }}>{o.sub}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ on, onToggle, small, disabled, label }) {
  return (
    <button
      type="button" className={`switch${on ? " on" : ""}${small ? " small" : ""}`}
      onClick={onToggle} disabled={disabled} role="switch" aria-checked={!!on} aria-label={label}
      style={disabled ? { opacity: 0.5 } : undefined}
    >
      <span className="switch-knob" />
    </button>
  );
}

export function SwitchRow({ title, sub, on, onToggle, small, disabled }) {
  return <Cell title={title} sub={sub} trailing={<Switch on={on} onToggle={onToggle} small={small} disabled={disabled} label={typeof title === "string" ? title : undefined} />} />;
}

export const Field = forwardRef(function Field(props, ref) {
  const { className, ...rest } = props;
  return <input {...rest} ref={ref} className={`field${className ? " " + className : ""}`} />;
});

export const TextArea = forwardRef(function TextArea(props, ref) {
  const { className, ...rest } = props;
  return <textarea {...rest} ref={ref} className={`field${className ? " " + className : ""}`} />;
});

export function Spinner({ size = 18 }) {
  return <span className="spinner" style={{ width: size, height: size }} role="status" aria-label="Loading" />;
}

export function Thinking() {
  return <span className="think" aria-label="Working"><i className="td" /><i className="td" /><i className="td" /></span>;
}

/* ── loading — layout-matched, never a centred spinner ─────────────────────── */
export function SkLine({ w = "80" }) { return <div className={`sk sk-line w${w}`} />; }

export function SkCard({ lines = 3, pad = "md" }) {
  return (
    <Card pad={pad}>
      <div className="sk sk-big" />
      {Array.from({ length: lines }, (_, i) => <SkLine key={i} w={i === lines - 1 ? "40" : i % 2 ? "60" : "80"} />)}
    </Card>
  );
}

export function SkPage({ cards = 3 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} aria-busy="true">
      {Array.from({ length: cards }, (_, i) => <SkCard key={i} lines={i === 0 ? 4 : 2} />)}
    </div>
  );
}

/* ── empty and error — designed, never defaulted ───────────────────────────── */
export function EmptyState({ icon, title, sub, action, style }) {
  return (
    <div className="empty" style={style}>
      {icon && <span className="empty-icon">{icon}</span>}
      {title && <span className="empty-title">{title}</span>}
      {sub && <span className="empty-sub">{sub}</span>}
      {action && <div style={{ marginTop: 10 }}>{action}</div>}
    </div>
  );
}

// Error states always carry a way forward. There are no dead-end banners in
// this app — if something failed, the retry is right there.
export function ErrorState({ title = "That didn't go through", detail, onRetry, retryLabel = "Try again", style }) {
  return (
    <div className="empty" style={style}>
      <span className="empty-title" style={{ color: "var(--red)" }}>{title}</span>
      {detail && <span className="empty-sub">{detail}</span>}
      {onRetry && <div style={{ marginTop: 10 }}><Button kind="tinted" size="sm" onClick={onRetry}>{retryLabel}</Button></div>}
    </div>
  );
}

/* ── sheets ────────────────────────────────────────────────────────────────── */
// Only the top-most sheet handles Escape, so a confirm layered over a form
// sheet doesn't dismiss both on one keypress.
const sheetStack = [];

export function Sheet({ onClose, title, headTrailing, footer, children, z = 300, bodyStyle, dismissible = true }) {
  const idRef = useRef(null);
  if (!idRef.current) idRef.current = {};
  const cbRef = useRef();
  cbRef.current = { onClose, dismissible };

  useEffect(() => {
    const id = idRef.current;
    sheetStack.push(id);
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      const { onClose, dismissible } = cbRef.current;
      if (dismissible && sheetStack[sheetStack.length - 1] === id) { e.stopPropagation(); onClose?.(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = sheetStack.indexOf(id);
      if (i >= 0) sheetStack.splice(i, 1);
    };
  }, []);

  // Portaled to <body>: page wrappers animate with transform, which makes them
  // the containing block for position:fixed — a sheet rendered in place could
  // sit under a live dock with a clipped scrim.
  return createPortal(
    <>
      <div className="sheet-scrim" style={{ zIndex: z }} onClick={dismissible ? onClose : undefined} />
      <div className="sheet" style={{ zIndex: z + 1 }} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
        <div className="sheet-grab" />
        {(title != null || headTrailing != null) && (
          <div className="sheet-head">
            <span className="t-title2" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "none" }}>
              {headTrailing}
              <IconButton label="Close" onClick={dismissible ? onClose : undefined} disabled={!dismissible}><IcClose size={19} /></IconButton>
            </span>
          </div>
        )}
        <div className="sheet-body scroll-thin" style={bodyStyle}>{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </>,
    document.body
  );
}

// Promise-based confirm — the house replacement for window.confirm.
export function useConfirm() {
  const [req, setReq] = useState(null);
  const confirm = useCallback((opts) => new Promise((resolve) => setReq({ ...opts, resolve })), []);
  const done = (v) => { req?.resolve(v); setReq(null); };
  const el = req ? (
    <Sheet
      onClose={() => done(false)} title={req.title} z={480}
      footer={
        <>
          <Button kind="quiet" size="lg" style={{ flex: 1 }} onClick={() => done(false)}>{req.cancelLabel || "Cancel"}</Button>
          <Button kind={req.destructive ? "danger-solid" : "primary"} size="lg" style={{ flex: 1 }} onClick={() => done(true)}>
            {req.confirmLabel || "Confirm"}
          </Button>
        </>
      }
    >
      {req.message && <div className="t-body" style={{ color: "var(--sub)", paddingBottom: 6 }}>{req.message}</div>}
    </Sheet>
  ) : null;
  return [el, confirm];
}

/* ── toasts — async confirmation that never shifts layout ──────────────────── */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    setItems((xs) => [...xs.slice(-2), { id, msg, err: opts.err, action: opts.action, actionLabel: opts.actionLabel }]);
    const life = opts.action ? 6500 : 3200;
    setTimeout(() => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, out: true } : x))), life);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), life + 260);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="toasts" role="status" aria-live="polite">
          {items.map((t) => (
            <div key={t.id} className={`toast${t.err ? " err" : ""}${t.out ? " out" : ""}`}>
              <span className="tdot" />
              <span className="tmsg">{t.msg}</span>
              {t.action && (
                <button
                  className="act-undo"
                  onClick={() => { t.action(); setItems((xs) => xs.filter((x) => x.id !== t.id)); }}
                >
                  {t.actionLabel || "Undo"}
                </button>
              )}
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastCtx.Provider>
  );
}

/* ── page furniture ────────────────────────────────────────────────────────── */
export function PageHead({ title, sub, trailing }) {
  return (
    <div className="content-head">
      <div style={{ minWidth: 0, flex: 1 }}>
        <h1 className="t-ltitle" style={{ margin: 0 }}>{title}</h1>
        {sub && <div className="t-foot" style={{ marginTop: 3 }}>{sub}</div>}
      </div>
      {trailing && <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 6 }}>{trailing}</div>}
    </div>
  );
}

export function Grid({ min = 300, gap = 12, children, style }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))`, gap, alignItems: "start", ...style }}>
      {children}
    </div>
  );
}

export { IcCheck, IcClose, IcChevronRight };
