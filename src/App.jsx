import { useEffect, useState, useRef } from "react";
import { useStore } from "./data/useStore.js";
import { applyTheme, watchSystemTheme } from "./theme.js";
import { VoiceProvider, useVoice } from "./voice/VoiceProvider.jsx";
import { ToastHost } from "./ui/kit.jsx";
import { useHotkey } from "./ui/hooks.js";
import Boot from "./shell/Boot.jsx";
import Onboarding from "./shell/Onboarding.jsx";
import { Sidebar, Dock } from "./shell/Shell.jsx";
import CommandK from "./shell/CommandK.jsx";
import SettingsSheet from "./shell/SettingsSheet.jsx";
import ConsolePage from "./pages/ConsolePage.jsx";
import DayPage from "./pages/DayPage.jsx";
import QueuePage from "./pages/QueuePage.jsx";
import BriefPage from "./pages/BriefPage.jsx";
import MemoryPage from "./pages/MemoryPage.jsx";
import { getState } from "./data/store.js";

const PAGES = {
  console: ConsolePage,
  day: DayPage,
  queue: QueuePage,
  brief: BriefPage,
  memory: MemoryPage,
};

function useIsPhone() {
  const [phone, setPhone] = useState(() => window.matchMedia("(max-width: 760px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const on = (e) => setPhone(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

function Workspace() {
  const [page, setPage] = useState("console");
  const [palette, setPalette] = useState(false);
  const [settings, setSettingsOpen] = useState(false);
  const voice = useVoice();
  const phone = useIsPhone();
  const holding = useRef(false);

  const Page = PAGES[page] || ConsolePage;

  useHotkey("mod+k", (e) => { e.preventDefault(); setPalette((v) => !v); }, { allowInField: true });
  useHotkey("mod+,", (e) => { e.preventDefault(); setSettingsOpen(true); }, { allowInField: true });

  // Escape stops SYNC mid-sentence. Sheets swallow it first when one is open,
  // so this only fires when there's nothing layered on top.
  useHotkey("escape", () => { if (voice.busy || voice.phase === "speaking") voice.stop(); }, { allowInField: true });

  // Hold space to talk. Deliberately not a toggle: the whole point is that you
  // can start speaking without deciding to first, and let go when you're done.
  useEffect(() => {
    const isField = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    // Space is also how a keyboard user activates a focused control. Taking it
    // for push-to-talk there would break the whole app for anyone not using a
    // mouse, so the binding stands down whenever something focusable has focus.
    const onControl = (el) => el && (el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute?.("role") === "switch");

    const down = (e) => {
      if (e.code !== "Space" || e.repeat || holding.current) return;
      if (isField(e.target) || palette || settings) return;
      if (onControl(e.target) || onControl(document.activeElement)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      holding.current = true;
      voice.holdStart();
    };
    const up = (e) => {
      if (e.code !== "Space" || !holding.current) return;
      e.preventDefault();
      holding.current = false;
      voice.holdEnd();
    };
    // A lost keyup (tab switch mid-hold) must not leave the microphone open.
    const blur = () => { if (holding.current) { holding.current = false; voice.holdEnd(); } };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [voice, palette, settings]);

  return (
    <div className="app">
      {!phone && <Sidebar page={page} setPage={setPage} onSettings={() => setSettingsOpen(true)} onPalette={() => setPalette(true)} />}

      <main className="app-main">
        {/* Keying on `page` restarts the entrance animation, so a destination
            develops instead of snapping into place. */}
        <div key={page} className="app-main" style={{ height: "auto", flex: 1, minHeight: 0 }}>
          <Page />
        </div>
        {phone && <Dock page={page} setPage={setPage} />}
      </main>

      <CommandK
        open={palette}
        onClose={() => setPalette(false)}
        setPage={setPage}
        voice={voice}
        onSettings={() => setSettingsOpen(true)}
      />
      {settings && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

export default function App() {
  const s = useStore();
  const [booted, setBooted] = useState(false);
  const [onboarded, setOnboarded] = useState(() => getState().settings.onboarded);

  // The room follows the preference, and follows the OS while that preference
  // is "auto".
  useEffect(() => { applyTheme(s.settings.theme); }, [s.settings.theme]);
  useEffect(() => watchSystemTheme(() => getState().settings.theme, () => {}), []);

  if (!booted) return <Boot onDone={() => setBooted(true)} />;

  return (
    <ToastHost>
      {onboarded
        ? <VoiceProvider><Workspace /></VoiceProvider>
        : <Onboarding onDone={() => setOnboarded(true)} />}
    </ToastHost>
  );
}
