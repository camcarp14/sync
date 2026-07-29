// ─── The Pentagon panel ──────────────────────────────────────────────────────
// Sign in, see what's connected, and resolve the one conflict that can happen.
// It lives in Settings rather than onboarding on purpose: SYNC is local-first
// and has to be completely usable before anyone signs into anything.

import { useState } from "react";
import { useCloud } from "../data/useStore.js";
import { signIn, sendLink, signOut, pull, takeRemote, keepLocal } from "../data/cloud.js";
import { SOURCES } from "../agent/pentagon-sources.js";
import { Button, Field, SectionHeader, Status, useToast } from "../ui/kit.jsx";

function ago(ts) {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

const STATUS = {
  off:          { state: "offline", label: "Not built in" },
  "signed-out": { state: "idle",    label: "Not connected" },
  "signing-in": { state: "thinking", label: "Connecting" },
  syncing:      { state: "thinking", label: "Syncing" },
  synced:       { state: "live",    label: "Connected" },
  conflict:     { state: "waiting", label: "Diverged" },
  error:        { state: "error",   label: "Error" },
};

export default function PentagonPanel() {
  const c = useCloud();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const st = STATUS[c.status] || STATUS["signed-out"];

  const doSignIn = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) toast(error, { err: true });
    else { setPassword(""); toast("Connected to the Pentagon"); }
  };

  const doLink = async () => {
    if (!email.trim()) { toast("Email first", { err: true }); return; }
    setBusy(true);
    const { error } = await sendLink(email);
    setBusy(false);
    toast(error ? error : "Sign-in link sent — check your email", { err: !!error });
  };

  const doSignOut = async () => {
    setBusy(true);
    await signOut();
    setBusy(false);
    toast("Disconnected. Everything stays on this device.");
  };

  if (!c.configured) {
    return (
      <section>
        <SectionHeader title="Pentagon" trailing={<Status state="offline" label="Not built in" />} />
        <div className="t-foot">This build has no Supabase project configured, so SYNC runs entirely on this device.</div>
      </section>
    );
  }

  return (
    <section>
      <SectionHeader title="Pentagon" trailing={<Status state={st.state} label={st.label} />} />

      {/* ── diverged ─────────────────────────────────────────────────────── */}
      {c.status === "conflict" && (
        <div
          style={{
            background: "var(--amber-a12, var(--surface-2))", border: "1px solid var(--amber)",
            borderRadius: 13, padding: "13px 14px", marginBottom: 12,
          }}
        >
          <div className="t-body" style={{ fontWeight: 600, marginBottom: 4 }}>Two copies have drifted apart</div>
          <div className="t-foot" style={{ marginBottom: 10 }}>
            {c.conflict?.device ? `${c.conflict.device} wrote` : "Another device wrote"} while this one had unsaved
            changes. Merging them automatically would resurrect things you deleted, so pick one — the other is
            discarded.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button kind="primary" size="md" onClick={() => takeRemote()} style={{ flex: 1 }}>
              Use {c.conflict?.device || "the other device"}
            </Button>
            <Button kind="quiet" size="md" onClick={() => keepLocal()} style={{ flex: 1 }}>
              Keep this device
            </Button>
          </div>
        </div>
      )}

      {c.status === "error" && c.message && (
        <div className="t-foot" style={{ color: "var(--red)", marginBottom: 10 }}>{c.message}</div>
      )}

      {/* ── signed out ───────────────────────────────────────────────────── */}
      {!c.user && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Field
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" autoComplete="username" spellCheck={false}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <Field
                type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") doSignIn(); }}
                placeholder="Password" autoComplete="current-password"
              />
              <Button kind="primary" size="md" onClick={doSignIn} disabled={busy || !email.trim() || !password} style={{ flex: "none" }}>
                Connect
              </Button>
            </div>
            <Button kind="quiet" size="md" onClick={doLink} disabled={busy}>Email me a link instead</Button>
          </div>
          <div className="t-foot" style={{ marginTop: 10 }}>
            The same account as Board Room. Connecting keeps SYNC's day, queue and memory in step across your devices,
            and lets it read the real calendar and the live business numbers. SYNC works fully without it — nothing
            here is required.
          </div>
        </>
      )}

      {/* ── signed in ────────────────────────────────────────────────────── */}
      {c.user && (
        <>
          <div
            style={{
              display: "flex", alignItems: "center", gap: 10, background: "var(--surface-2)",
              borderRadius: 13, padding: "12px 14px",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="t-body" style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.user.email}
              </div>
              <div className="t-foot">
                {c.device} · revision {c.rev} · synced {ago(c.syncedAt)}
              </div>
            </div>
            <Button kind="quiet" size="sm" onClick={() => pull({ force: true })} disabled={busy} style={{ flex: "none" }}>
              Refresh
            </Button>
            <Button kind="quiet" size="sm" onClick={doSignOut} disabled={busy} style={{ flex: "none" }}>
              Disconnect
            </Button>
          </div>

          <div className="t-label" style={{ margin: "14px 0 7px" }}>What SYNC can reach</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {SOURCES.map((s) => {
              const on = s.scope === "personal" || c.owner;
              return (
                <span
                  key={s.key}
                  className="t-cap"
                  title={s.desc}
                  style={{
                    padding: "5px 10px", borderRadius: 999, fontWeight: 600,
                    background: on ? "var(--accent-a12)" : "var(--surface-2)",
                    color: on ? "var(--accent)" : "var(--faint)",
                  }}
                >
                  {s.label}
                </span>
              );
            })}
          </div>

          <div className="t-foot" style={{ marginTop: 10 }}>
            {c.owner
              ? "Personal data is scoped to this account by the database itself. The business sources go through an ownership check, so the public app key alone opens nothing."
              : "This account isn't the Pentagon owner, so the business sources stay closed. Personal data is readable and scoped to you."}
          </div>
        </>
      )}
    </section>
  );
}
