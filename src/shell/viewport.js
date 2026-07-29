// ─── The only height this window can actually render ─────────────────────────
// This is Board Room's geometry, adopted verbatim after five attempts at
// inventing my own failed on the same device. Every line below is field-proven
// there; treat the comments as load-bearing.
//
// The rule that matters: `visualViewport.height` is the ONLY height an iOS
// standalone window can render. 100vh, 100lvh, 100dvh and screen.height all
// report the full screen, but the window CLIPS everything below vvh — content
// sized past it is cut, never shown. Sizing the frame to screen.height (which
// I tried) therefore makes the problem worse, not better: the tab bar gets
// pushed into the clipped region and the visible gap grows.
//
// innerHeight is not a substitute either. vvh is the measurement that tracks
// the keyboard, the letterbox and the status bar together.

import { useState, useEffect } from "react";

export const IS_STANDALONE =
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true);

// Measured env(safe-area-inset-top): >0 means the window sits UNDER the status
// bar (top-anchored). The broken letterboxed window has envTop 59; a healthy
// below-status-bar window has envTop 0 — the discriminator for whether the
// reported bottom inset corresponds to paintable space.
function measureEnvTop() {
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:env(safe-area-inset-top);";
  document.body.appendChild(el);
  const h = el.getBoundingClientRect().height;
  el.remove();
  return Math.round(h);
}

export function useVisualViewport() {
  const get = () => ({
    vvh: typeof window !== "undefined" && window.visualViewport ? Math.round(window.visualViewport.height) : null,
    envTop: typeof document !== "undefined" && document.body ? measureEnvTop() : 0,
  });
  const [vp, setVp] = useState(get);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setVp(get())); };
    on();
    vv.addEventListener("resize", on);
    vv.addEventListener("scroll", on);
    window.addEventListener("orientationchange", on);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", on);
      vv.removeEventListener("scroll", on);
      window.removeEventListener("orientationchange", on);
    };
  }, []);

  return vp;
}

/**
 * A letterboxed standalone window: renderable height falls short of the screen
 * WHILE the window is top-anchored under the status bar (envTop > 0). There the
 * OS strip already clears the home indicator, so the reported bottom inset is
 * dead space and the tab bar must drop it. A healthy below-status-bar window
 * (envTop 0) keeps the native inset even though vvh < screen.height.
 */
export function isLetterboxed(vvh, envTop) {
  if (!IS_STANDALONE || vvh == null || !window.screen?.height) return false;
  return window.screen.height - vvh >= 20 && envTop > 0;
}

/** Rendered in Settings, so a wrong layout arrives with numbers attached. */
export function viewportReport(vvh, envTop) {
  return {
    vvh,
    envTop,
    innerH: typeof window !== "undefined" ? window.innerHeight : 0,
    screenH: typeof window !== "undefined" ? window.screen?.height || 0 : 0,
    standalone: IS_STANDALONE,
    letterboxed: isLetterboxed(vvh, envTop),
  };
}
