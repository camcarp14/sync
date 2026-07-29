import { useState } from "react";
import { Mark } from "./Boot.jsx";
import { setSettings, setProfile, getState } from "../data/store.js";
import { Button, Field, TextArea } from "../ui/kit.jsx";
import { IcCheck, IcKey, IcSparkle } from "../ui/icons.jsx";
import { STARTER_VENTURES, STARTER_DIRECTIVES } from "../data/seed.js";
import { id } from "../lib/id.js";

// ─── First run ───────────────────────────────────────────────────────────────
// Three screens, none of them skippable-but-required. The key screen can be
// passed over — SYNC will simply say what it needs when you first talk to it,
// which is better than a wall between someone and the thing they just opened.

const TONES = ["var(--accent)", "var(--green)", "var(--amber)", "var(--purple)", "var(--pink)"];

export default function Onboarding({ onDone }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [key, setKey] = useState("");
  const [picked, setPicked] = useState(() => new Set(STARTER_VENTURES.map((v) => v.key)));
  const [directives, setDirectives] = useState(() => new Set(STARTER_DIRECTIVES));
  const [custom, setCustom] = useState("");

  const toggle = (setter, value) => setter((prev) => {
    const next = new Set(prev);
    next.has(value) ? next.delete(value) : next.add(value);
    return next;
  });

  const finish = () => {
    const ventures = STARTER_VENTURES
      .filter((v) => picked.has(v.key))
      .map((v, i) => ({ ...v, key: id("v"), tone: TONES[i % TONES.length] }));
    const extra = custom.split("\n").map((x) => x.trim()).filter(Boolean);
    for (const nameStr of extra) {
      ventures.push({ key: id("v"), name: nameStr, note: "", tone: TONES[ventures.length % TONES.length] });
    }
    setProfile({ name: name.trim(), role: role.trim(), ventures, directives: [...directives] });
    setSettings({ apiKey: key.trim() || getState().settings.apiKey, onboarded: true });
    onDone();
  };

  return (
    <div className="entrance">
      <div className="entrance-card">
        {step === 0 && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <Mark size={26} />
              <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "0.34em" }}>SYNC</span>
            </div>
            <div>
              <div className="t-title1">You talk. It runs the day.</div>
              <div className="t-body" style={{ color: "var(--sub)", marginTop: 8 }}>
                Say what needs to happen and SYNC does it — books the block, moves the meeting, takes the note, chases
                the thing that's gone quiet. Every action it takes shows up with an Undo next to it, and everything it
                knows stays in this browser.
              </div>
            </div>
            <div>
              <div className="t-label" style={{ marginBottom: 6 }}>What should it call you?</div>
              <Field value={name} onChange={(e) => setName(e.target.value)} placeholder="Cameron" autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") setStep(1); }} />
            </div>
            <div>
              <div className="t-label" style={{ marginBottom: 6 }}>What do you actually do all day?</div>
              <TextArea rows={2} value={role} onChange={(e) => setRole(e.target.value)}
                placeholder="Run two ventures alongside a day job in paid search." />
            </div>
            <Button kind="primary" size="lg" full onClick={() => setStep(1)}>Continue</Button>
          </>
        )}

        {step === 1 && (
          <>
            <div className="t-label"><IcKey size={13} style={{ verticalAlign: "-2px" }} /> Step 2 of 3</div>
            <div>
              <div className="t-title1">Give it a brain.</div>
              <div className="t-body" style={{ color: "var(--sub)", marginTop: 8 }}>
                SYNC runs on your own Anthropic API key. It's stored in this browser, never leaves it except to reach
                Anthropic, and is excluded from every export. You can add it later in Settings — nothing else here
                needs it.
              </div>
            </div>
            <Field
              type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…"
              autoComplete="off" spellCheck={false}
              style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
              onKeyDown={(e) => { if (e.key === "Enter") setStep(2); }}
            />
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="t-foot" style={{ color: "var(--accent)" }}>
              Get a key from the Anthropic console →
            </a>
            <div style={{ display: "flex", gap: 8 }}>
              <Button kind="quiet" size="lg" onClick={() => setStep(0)}>Back</Button>
              <Button kind="primary" size="lg" style={{ flex: 1 }} onClick={() => setStep(2)}>
                {key.trim() ? "Continue" : "Skip for now"}
              </Button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="t-label"><IcSparkle size={13} style={{ verticalAlign: "-2px" }} /> Step 3 of 3</div>
            <div>
              <div className="t-title1">What are you running?</div>
              <div className="t-body" style={{ color: "var(--sub)", marginTop: 8 }}>
                SYNC sorts your day by these. Keep what fits, drop what doesn't — you can change all of it later.
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {STARTER_VENTURES.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  className={`opt${picked.has(v.key) ? " on" : ""}`}
                  onClick={() => toggle(setPicked, v.key)}
                  aria-pressed={picked.has(v.key)}
                >
                  <span className="opt-tick"><IcCheck size={14} /></span>
                  <span className="opt-body">
                    <span className="opt-title">{v.name}</span>
                    <span className="opt-sub">{v.note}</span>
                  </span>
                </button>
              ))}
            </div>

            <div>
              <div className="t-label" style={{ marginBottom: 6 }}>Anything else? One per line</div>
              <TextArea rows={2} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Optional" />
            </div>

            <div>
              <div className="t-label" style={{ marginBottom: 6 }}>How it should behave</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {STARTER_DIRECTIVES.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`opt${directives.has(d) ? " on" : ""}`}
                    onClick={() => toggle(setDirectives, d)}
                    aria-pressed={directives.has(d)}
                  >
                    <span className="opt-tick"><IcCheck size={14} /></span>
                    <span className="opt-body">
                      <span className="opt-sub" style={{ color: "var(--ink)", fontSize: 13.5 }}>{d}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <Button kind="quiet" size="lg" onClick={() => setStep(1)}>Back</Button>
              <Button kind="primary" size="lg" style={{ flex: 1 }} onClick={finish}>Start</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
