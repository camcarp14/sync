// The room is applied to <html> and to the OS chrome colour together, so the
// notch, the status bar and the page never disagree. index.html resolves the
// stored value before first paint; this keeps it honest after that.

const COLORS = { night: "#000000", day: "#F1F3F6" };

export function resolveTheme(pref) {
  if (pref === "night" || pref === "day") return pref;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "day" : "night";
}

export function applyTheme(pref) {
  const room = resolveTheme(pref);
  document.documentElement.setAttribute("data-theme", room);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", COLORS[room]);
  return room;
}

/** Follow the OS while the preference is "auto". Returns an unsubscribe. */
export function watchSystemTheme(getPref, onChange) {
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  const handler = () => { if (getPref() === "auto") onChange(applyTheme("auto")); };
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
