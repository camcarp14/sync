import { useEffect, useRef } from "react";

// ─── The orb ─────────────────────────────────────────────────────────────────
// The one piece of atmosphere in the building, and the app's only status
// display that works from across the room. Three luminous lobes orbit a common
// centre and blend additively; their radius follows the microphone when SYNC is
// listening and its own speech cadence when it's talking. Everything else in
// the app is flat and quiet so that this can move.
//
// It is deliberately a canvas and not an SVG animation: at 60fps with three
// blurred radial gradients, canvas costs a fraction of the compositing and
// never fights the rest of the page for layout.

// base is the lobe radius as a fraction of the orb; drift is how far the lobes
// wander from centre. Idle deliberately keeps a body — an assistant that looks
// switched off when it isn't is a design failure, not restraint.
const STATE_ENERGY = {
  idle: { base: 0.52, drift: 0.10, wobble: 0.035, speed: 0.30, spin: 0.10 },
  listening: { base: 0.60, drift: 0.15, wobble: 0.075, speed: 0.85, spin: 0.34 },
  thinking: { base: 0.56, drift: 0.19, wobble: 0.105, speed: 1.60, spin: 1.05 },
  speaking: { base: 0.64, drift: 0.16, wobble: 0.090, speed: 1.15, spin: 0.46 },
  error: { base: 0.46, drift: 0.06, wobble: 0.020, speed: 0.22, spin: 0.06 },
};

const readVar = (el, name, fallback) => {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
};

export default function VoiceOrb({
  size = 168,
  state = "idle",
  level = 0,
  onClick,
  disabled,
  label = "Talk to SYNC",
}) {
  const canvasRef = useRef(null);
  const stateRef = useRef(state);
  const levelRef = useRef(0);
  const rafRef = useRef(0);

  stateRef.current = state;
  // The raw meter is jittery; ease toward it so the orb reads as breathing
  // rather than twitching.
  levelRef.current += (Math.min(1, Math.max(0, level)) - levelRef.current) * 0.22;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const root = document.documentElement;
    let colors = [];
    let light = false;

    // Additive blending is right on black and wrong on white: on a pale
    // surface "lighter" drives every overlap toward white, and the orb
    // dissolves. QUARTZ gets ordinary alpha compositing instead, which reads
    // like ink in water rather than light in a dark room.
    const readPalette = () => {
      colors = [
        readVar(root, "--orb-1", "#6AA8FF"),
        readVar(root, "--orb-2", "#A98BF5"),
        readVar(root, "--orb-3", "#35C08A"),
      ];
      light = root.getAttribute("data-theme") === "day";
    };
    readPalette();

    // The room can change under the orb; re-read the palette when it does.
    const themeWatcher = new MutationObserver(readPalette);
    themeWatcher.observe(root, { attributes: true, attributeFilter: ["data-theme"] });

    const cx = size / 2;
    const cy = size / 2;
    const R = size / 2;
    let t = 0;
    let paused = false;

    const onVis = () => { paused = document.hidden; if (!paused) loop(performance.now()); };
    document.addEventListener("visibilitychange", onVis);

    let last = performance.now();

    const draw = () => {
      const e = STATE_ENERGY[stateRef.current] || STATE_ENERGY.idle;
      const lvl = stateRef.current === "listening" ? levelRef.current : 0;

      ctx.clearRect(0, 0, size, size);

      // A soft floor so the orb reads as one body and not three loose blobs.
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      core.addColorStop(0, colors[0] + (light ? "22" : "3A"));
      core.addColorStop(0.62, colors[0] + (light ? "0C" : "14"));
      core.addColorStop(1, "transparent");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.98, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalCompositeOperation = light ? "source-over" : "lighter";
      const [hot, mid] = light ? ["96", "3A"] : ["B8", "4E"];
      for (let i = 0; i < 3; i++) {
        const phase = t * e.speed + (i * Math.PI * 2) / 3;
        // Two incommensurate frequencies per lobe: the motion never visibly
        // repeats, which is the difference between "alive" and "looping".
        const drift = e.drift + e.wobble * (Math.sin(phase * 1.7) * 0.5 + 0.5) + lvl * 0.14;
        const ox = Math.cos(phase + t * e.spin) * R * drift;
        const oy = Math.sin(phase * 1.13 + t * e.spin) * R * drift;
        const radius = R * (e.base + lvl * 0.26 + Math.sin(phase * 0.9) * e.wobble);

        const g = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, Math.max(1, radius));
        g.addColorStop(0, colors[i] + hot);
        g.addColorStop(0.38, colors[i] + mid);
        g.addColorStop(1, colors[i] + "00");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx + ox, cy + oy, Math.max(1, radius), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      // A hairline edge gives the whole thing a defined boundary — without it
      // the orb dissolves into the background on a light theme.
      ctx.strokeStyle = colors[0] + "38";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, R - 0.5, 0, Math.PI * 2);
      ctx.stroke();
    };

    const loop = (now) => {
      if (paused) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };

    if (reduced) {
      // Reduced motion still gets a rendered orb — it just doesn't move.
      draw();
    } else {
      rafRef.current = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
      document.removeEventListener("visibilitychange", onVis);
      themeWatcher.disconnect();
    };
  }, [size]);

  // The ring is a separate, non-animated SVG: state changes read instantly
  // even for someone who can't perceive the orb's motion.
  const ringR = size / 2 - 3;
  const circumference = 2 * Math.PI * ringR;

  return (
    <div className="orb-wrap" data-state={state} style={{ width: size, height: size }}>
      <span className="orb-halo" />
      <canvas ref={canvasRef} className="orb-canvas" style={{ width: size, height: size }} />
      <svg className="orb-ring" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2} cy={size / 2} r={ringR}
          stroke="var(--ink-a08)" strokeWidth="2"
        />
        <circle
          cx={size / 2} cy={size / 2} r={ringR}
          stroke={state === "error" ? "var(--red)" : "var(--accent)"}
          strokeWidth="2.5"
          strokeDasharray={
            state === "thinking" ? `${circumference * 0.22} ${circumference}` :
            state === "listening" ? `${circumference * (0.30 + level * 0.55)} ${circumference}` :
            state === "speaking" ? `${circumference * 0.82} ${circumference}` :
            state === "error" ? `${circumference} ${circumference}` :
            `0 ${circumference}`
          }
          style={{
            transform: "rotate(-90deg)",
            transformOrigin: "center",
            transition: "stroke-dasharray var(--dur-2) var(--ease-out), stroke var(--dur-2) ease",
            animation: state === "thinking" ? "spin 1.4s linear infinite" : "none",
          }}
        />
      </svg>
      {onClick && (
        <button
          type="button"
          className="orb-btn"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          title={label}
        />
      )}
    </div>
  );
}
