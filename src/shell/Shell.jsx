import { NAV, navBadges } from "./nav.js";
import { Mark } from "./Boot.jsx";
import { useStore } from "../data/useStore.js";
import { useVoice } from "../voice/VoiceProvider.jsx";
import { Dot, IconButton } from "../ui/kit.jsx";
import { IcSettings, IcMic, IcMicOff, IcCommand } from "../ui/icons.jsx";

// ─── The frame ───────────────────────────────────────────────────────────────
// A 232px rail on tablet and desktop; a native tab bar on a phone. Both drive
// the same `page` value, and both show the same live status — SYNC's state is
// visible from every surface, never only from the Console.

const PHASE_TONE = {
  idle: "var(--faint)",
  listening: "var(--accent)",
  thinking: "var(--accent)",
  speaking: "var(--purple)",
  error: "var(--red)",
};

const PHASE_LABEL = {
  idle: "Standing by",
  listening: "Listening",
  thinking: "Working",
  speaking: "Speaking",
  error: "Error",
};

export function Sidebar({ page, setPage, onSettings, onPalette }) {
  const s = useStore();
  const voice = useVoice();
  const badges = navBadges(s);
  const live = voice.phase !== "idle";

  return (
    <nav className="sidebar" aria-label="Main">
      <div className="side-brand">
        <Mark size={20} />
        <span className="side-brand-name">SYNC</span>
      </div>

      <div className="side-nav">
        {NAV.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={`side-item${page === key ? " active" : ""}`}
            onClick={() => setPage(key)}
            aria-current={page === key ? "page" : undefined}
          >
            <span className="side-ic"><Icon size={18} /></span>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
            {badges[key] > 0 && <span className="side-badge">{badges[key]}</span>}
          </button>
        ))}
      </div>

      <div className="side-foot">
        <button
          className="side-item"
          onClick={onPalette}
          style={{ color: "var(--faint)", fontSize: 13 }}
          title="Command palette"
        >
          <span className="side-ic"><IcCommand size={16} /></span>
          <span>Commands</span>
          <kbd style={{ marginLeft: "auto" }}>⌘K</kbd>
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px" }}>
          <Dot tone={PHASE_TONE[voice.phase]} pulse={live} size={6} />
          <span className="t-cap" style={{ color: live ? PHASE_TONE[voice.phase] : "var(--faint)", fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {PHASE_LABEL[voice.phase]}
          </span>
          <IconButton
            label={s.settings.ambient ? "Stop listening" : "Listen for the wake word"}
            on={s.settings.ambient}
            onClick={voice.toggleAmbient}
            disabled={!voice.sttSupported}
          >
            {s.settings.ambient ? <IcMic size={17} /> : <IcMicOff size={17} />}
          </IconButton>
          <IconButton label="Settings" onClick={onSettings}><IcSettings size={17} /></IconButton>
        </div>
      </div>
    </nav>
  );
}

export function Dock({ page, setPage }) {
  const s = useStore();
  const badges = navBadges(s);
  return (
    <nav className="dock" aria-label="Main">
      {NAV.map(({ key, label, Icon }) => (
        <button
          key={key}
          className={`dock-tab${page === key ? " active" : ""}`}
          onClick={() => setPage(key)}
          aria-current={page === key ? "page" : undefined}
        >
          <span className="dock-icon">
            <Icon size={22} />
            {badges[key] > 0 && page !== key && <span className="dock-pip" />}
          </span>
          <span className="dock-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
