import { useEffect, useRef, useState } from "react";
import { useStore } from "../data/useStore.js";
import {
  setSettings, setProfile, exportState, importState, resetAll, clearConversation, getState,
} from "../data/store.js";
import { useVoice } from "../voice/VoiceProvider.jsx";
import {
  Sheet, Button, Segmented, SwitchRow, Field, Cell, CellGroup, SectionHeader,
  useConfirm, useToast, StatTile, Status,
} from "../ui/kit.jsx";
import { IcDownload, IcUpload, IcTrash, IcSpeaker } from "../ui/icons.jsx";
import { MODELS } from "../agent/transport.js";
import { listVoices, onVoicesReady } from "../voice/speaker.js";
import { fmt24, parseTime } from "../lib/time.js";

export default function SettingsSheet({ onClose }) {
  const s = useStore();
  const voice = useVoice();
  const toast = useToast();
  const [confirmEl, confirm] = useConfirm();
  const [voices, setVoices] = useState(() => listVoices());
  const [keyDraft, setKeyDraft] = useState(s.settings.apiKey);
  const [showKey, setShowKey] = useState(false);
  const [hours, setHours] = useState({ start: fmt24(s.profile.workStart), end: fmt24(s.profile.workEnd) });
  const fileRef = useRef(null);

  useEffect(() => onVoicesReady(setVoices), []);

  const saveKey = () => {
    const k = keyDraft.trim();
    setSettings({ apiKey: k });
    toast(k ? "Key saved to this browser" : "Key cleared");
  };

  const commitHours = () => {
    const a = parseTime(hours.start);
    const b = parseTime(hours.end);
    if (a == null || b == null || b <= a) {
      setHours({ start: fmt24(s.profile.workStart), end: fmt24(s.profile.workEnd) });
      toast("Those hours don't read — reverted", { err: true });
      return;
    }
    setProfile({ workStart: a, workEnd: b });
  };

  const doExport = () => {
    const url = URL.createObjectURL(new Blob([exportState()], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `sync-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Exported — your API key is not in the file");
  };

  const doImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!(await confirm({
      title: "Replace everything?",
      message: "Importing overwrites the day, the queue and everything SYNC remembers. Your API key stays.",
      confirmLabel: "Import",
      destructive: true,
    }))) return;
    try {
      importState(await file.text());
      toast("Imported");
    } catch {
      toast("That file didn't parse as SYNC data", { err: true });
    }
  };

  const doReset = async () => {
    if (!(await confirm({
      title: "Erase everything?",
      message: "The plan, the queue, every note and everything SYNC remembers. Your API key stays. There is no undo for this one.",
      confirmLabel: "Erase",
      destructive: true,
    }))) return;
    resetAll({ keepKey: true });
    toast("Erased");
    onClose();
  };

  const keyChanged = keyDraft.trim() !== s.settings.apiKey;
  const connection = s.settings.apiKey ? "live" : "waiting";

  return (
    <>
      {confirmEl}
      <Sheet onClose={onClose} title="Settings" headTrailing={<Status state={connection} label={s.settings.apiKey ? "Key set" : "No key"} />}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

          {/* ── the key ─────────────────────────────────────────────── */}
          <section>
            <SectionHeader title="Anthropic key" />
            <div style={{ display: "flex", gap: 8 }}>
              <Field
                type={showKey ? "text" : "password"}
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder="sk-ant-…"
                autoComplete="off"
                spellCheck={false}
                style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
              />
              <Button kind="quiet" size="md" onClick={() => setShowKey((v) => !v)} style={{ flex: "none" }}>
                {showKey ? "Hide" : "Show"}
              </Button>
              <Button kind={keyChanged ? "primary" : "quiet"} size="md" onClick={saveKey} disabled={!keyChanged} style={{ flex: "none" }}>
                Save
              </Button>
            </div>
            <div className="t-foot" style={{ marginTop: 8 }}>
              Stored in this browser only. It is never included in an export, and never sent anywhere except
              Anthropic. Leave it empty to route through a deployed <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>/.netlify/functions/claude</code> proxy instead.
            </div>
          </section>

          {/* ── the model ───────────────────────────────────────────── */}
          <section>
            <SectionHeader title="Model" trailing={MODELS.find((m) => m.key === s.settings.model)?.blurb} />
            <Segmented
              options={MODELS.map((m) => ({ key: m.key, label: m.label }))}
              value={s.settings.model}
              onChange={(model) => setSettings({ model })}
            />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 10 }}>
              <StatTile value={s.usage.calls.toLocaleString()} label="model calls" />
              <StatTile value={`${Math.round((s.usage.in + s.usage.out) / 1000)}k`} label="tokens" />
              <StatTile value={`$${s.usage.cost.toFixed(2)}`} label="est. spend" />
            </div>
            <div className="t-foot" style={{ marginTop: 8 }}>
              Spend is an estimate from published per-token rates — treat Anthropic's console as the real number.
            </div>
          </section>

          {/* ── voice ───────────────────────────────────────────────── */}
          <section>
            <SectionHeader title="Voice" />
            <CellGroup>
              <SwitchRow
                title="Speak replies"
                sub={voice.ttsSupported ? "SYNC reads its answers out loud" : "This browser has no speech synthesis"}
                on={s.settings.speak}
                onToggle={() => { setSettings({ speak: !s.settings.speak }); if (s.settings.speak) voice.shutUp(); }}
                disabled={!voice.ttsSupported}
              />
              <SwitchRow
                title="Listen for the wake word"
                sub={voice.sttSupported ? `Say "${s.settings.wakeWord}" and keep talking` : "This browser has no speech recognition"}
                on={s.settings.ambient}
                onToggle={voice.toggleAmbient}
                disabled={!voice.sttSupported}
              />
              <SwitchRow
                title="Live web search"
                sub="Lets SYNC look things up mid-answer"
                on={s.settings.webSearch}
                onToggle={() => setSettings({ webSearch: !s.settings.webSearch })}
              />
            </CellGroup>

            <div style={{ marginTop: 10 }}>
              <div className="t-label" style={{ marginBottom: 6 }}>Wake word</div>
              <Field
                value={s.settings.wakeWord}
                onChange={(e) => setSettings({ wakeWord: e.target.value.toLowerCase().slice(0, 16) })}
                placeholder="sync"
              />
            </div>

            {voices.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="t-label" style={{ marginBottom: 6 }}>Which voice</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <select
                    className="field"
                    value={s.settings.voiceURI || voices[0]?.voiceURI || ""}
                    onChange={(e) => setSettings({ voiceURI: e.target.value })}
                    style={{ flex: 1, appearance: "none" }}
                  >
                    {voices.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>{v.name}{v.localService ? "" : " · online"}</option>
                    ))}
                  </select>
                  <Button
                    kind="quiet" size="md" style={{ flex: "none" }}
                    onClick={() => voice.speak("Standing by. Two blocks left today, and the Northside follow-up is three days cold.")}
                  >
                    <IcSpeaker size={16} /> Test
                  </Button>
                </div>
              </div>
            )}

            <div style={{ marginTop: 10 }}>
              <div className="t-label" style={{ marginBottom: 6 }}>Pace · {s.settings.rate.toFixed(2)}×</div>
              <input
                type="range" min="0.7" max="1.6" step="0.01"
                value={s.settings.rate}
                onChange={(e) => setSettings({ rate: Number(e.target.value) })}
                style={{ width: "100%", accentColor: "var(--accent)" }}
                aria-label="Speaking pace"
              />
            </div>
          </section>

          {/* ── you ─────────────────────────────────────────────────── */}
          <section>
            <SectionHeader title="You" />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Field
                value={s.profile.name}
                onChange={(e) => setProfile({ name: e.target.value })}
                placeholder="What SYNC should call you"
              />
              <Field
                value={s.profile.role}
                onChange={(e) => setProfile({ role: e.target.value })}
                placeholder="What you actually do all day"
              />
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <div className="t-label" style={{ marginBottom: 6 }}>Day starts</div>
                  <Field value={hours.start} onChange={(e) => setHours((h) => ({ ...h, start: e.target.value }))} onBlur={commitHours} inputMode="numeric" />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="t-label" style={{ marginBottom: 6 }}>Day ends</div>
                  <Field value={hours.end} onChange={(e) => setHours((h) => ({ ...h, end: e.target.value }))} onBlur={commitHours} inputMode="numeric" />
                </div>
              </div>
            </div>
          </section>

          {/* ── the room ────────────────────────────────────────────── */}
          <section>
            <SectionHeader title="Room" />
            <Segmented
              options={[
                { key: "night", label: "Obsidian" },
                { key: "day", label: "Quartz" },
                { key: "auto", label: "Auto" },
              ]}
              value={s.settings.theme}
              onChange={(theme) => setSettings({ theme })}
            />
          </section>

          {/* ── the data ────────────────────────────────────────────── */}
          <section>
            <SectionHeader title="Your data" />
            <CellGroup>
              <Cell leading={<IcDownload size={15} />} leadingTone="var(--accent)" title="Export everything" sub="One JSON file — key excluded" chevron onClick={doExport} />
              <Cell leading={<IcUpload size={15} />} leadingTone="var(--accent)" title="Import a backup" sub="Replaces what's here" chevron onClick={() => fileRef.current?.click()} />
              <Cell leading={<IcTrash size={15} />} leadingTone="var(--faint)" title="Clear this conversation" sub="The transcript only — the day stays" chevron onClick={() => { clearConversation(); toast("Conversation cleared"); }} />
              <Cell destructive leading={<IcTrash size={15} />} leadingTone="var(--red)" title="Erase everything" sub="No undo" chevron onClick={doReset} />
            </CellGroup>
            <input ref={fileRef} type="file" accept="application/json,.json" onChange={doImport} style={{ display: "none" }} />
            <div className="t-foot" style={{ marginTop: 10 }}>
              Everything SYNC knows lives in this browser and nowhere else. Clearing site data erases it, so export
              before you do anything drastic.
            </div>
          </section>

        </div>
      </Sheet>
    </>
  );
}
