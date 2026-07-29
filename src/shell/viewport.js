// ─── The viewport, measured rather than assumed ──────────────────────────────
// iOS reports its own geometry badly in exactly the configuration this app is
// built for — installed to the home screen, drawing under the status bar. Two
// specific lies, both of which shipped a broken layout before this file
// existed:
//
//   1. `env(safe-area-inset-top)` returns 0 while the OS is very much drawing
//      the app under the clock, so anything relying on it sits underneath the
//      status bar.
//   2. `100dvh` goes stale after the keyboard opens and closes, leaving the
//      tab bar floating short of the bottom of the screen.
//
// `@media (display-mode: standalone)` is not a reliable escape hatch either —
// iOS Safari has its own `navigator.standalone` flag and doesn't always match
// the standard query.
//
// So nothing here is assumed. A hidden probe element is asked what the insets
// actually resolve to, the result is sanity-checked against the screen, and the
// answers are published as CSS variables that the stylesheet uses instead of
// env() and dvh. If the platform tells the truth, the truth is what gets used.

const PROBE_STYLE = [
  "position:fixed", "top:0", "left:0", "width:0", "height:0",
  "visibility:hidden", "pointer-events:none",
  "padding-top:env(safe-area-inset-top,0px)",
  "padding-bottom:env(safe-area-inset-bottom,0px)",
].join(";");

/** True when the app is running without browser chrome. */
export function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.navigator.standalone === true ||                       // iOS Safari
    window.matchMedia?.("(display-mode: standalone)").matches ||  // the standard
    window.matchMedia?.("(display-mode: fullscreen)").matches ||
    window.matchMedia?.("(display-mode: minimal-ui)").matches
  );
}

/**
 * Publish --safe-top, --safe-bottom and --app-h on <html>, and keep them
 * current. Returns a teardown, and the last measurement for diagnostics.
 */
export function installViewport() {
  if (typeof document === "undefined") return () => {};
  const root = document.documentElement;

  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = PROBE_STYLE;
  document.body.appendChild(probe);

  const measure = () => {
    const cs = getComputedStyle(probe);
    const reportedTop = parseFloat(cs.paddingTop) || 0;
    const reportedBottom = parseFloat(cs.paddingBottom) || 0;
    const standalone = isStandalone();

    const innerH = window.innerHeight || 0;
    const screenH = window.screen?.height || 0;
    // When the app fills the screen, whatever the OS paints on top of it —
    // clock, signal, battery — is painted over our content. That is the only
    // case where a zero inset is a lie worth overriding.
    const fullBleed = standalone && screenH > 0 && innerH >= screenH - 4;

    let top = reportedTop;
    let inferred = false;
    if (top === 0 && fullBleed) {
      // 47pt covers every notched and Dynamic Island iPhone; on the older
      // 20pt status bars it costs a few points of headroom and breaks nothing.
      top = 47;
      inferred = true;
    }

    const bottom = reportedBottom === 0 && fullBleed ? 34 : reportedBottom;

    root.style.setProperty("--safe-top", `${top}px`);
    root.style.setProperty("--safe-bottom", `${bottom}px`);
    // The one height the layout trusts. innerHeight is correct the instant it
    // is read, which is more than dvh manages after a keyboard dismissal.
    root.style.setProperty("--app-h", `${innerH}px`);
    root.dataset.standalone = standalone ? "true" : "false";

    last = { standalone, fullBleed, reportedTop, reportedBottom, top, bottom, inferred, innerH, screenH };
  };

  let last = {};
  measure();

  // A frame later as well: iOS settles its insets after first paint, and the
  // first read can land before that.
  requestAnimationFrame(measure);
  const settle = setTimeout(measure, 350);

  const onResize = () => measure();
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  window.visualViewport?.addEventListener("resize", onResize);
  // Returning from the app switcher can restore a stale height.
  document.addEventListener("visibilitychange", onResize);

  installViewport.read = () => last;

  return () => {
    clearTimeout(settle);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("orientationchange", onResize);
    window.visualViewport?.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onResize);
    probe.remove();
  };
}

/** What the last measurement found — rendered in Settings so a wrong layout
 *  can be diagnosed from a screenshot instead of another round of guessing. */
export const viewportReport = () => installViewport.read?.() || {};
