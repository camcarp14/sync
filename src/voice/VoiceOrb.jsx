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

    const drawLobes = (e, lvl, hot, mid, scale = 1) => {
      for (let i = 0; i < 3; i++) {
        const phase = t * e.speed + (i * Math.PI * 2) / 3;
        // Two incommensurate frequencies per lobe: the motion never visibly
        // repeats, which is the difference between "alive" and "looping".
        const drift = e.drift + e.wobble * (Math.sin(phase * 1.7) * 0.5 + 0.5) + lvl * 0.14;
        const ox = Math.cos(phase + t * e.spin) * R * drift;
        const oy = Math.sin(phase * 1.13 + t * e.spin) * R * drift;
        const radius = R * (e.base + lvl * 0.26 + Math.sin(phase * 0.9) * e.wobble) * scale;

        const g = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, Math.max(1, radius));
        g.addColorStop(0, colors[i] + hot);
        g.addColorStop(0.4, colors[i] + mid);
        g.addColorStop(1, colors[i] + "00");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx + ox, cy + oy, Math.max(1, radius), 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const draw = () => {
      const e = STATE_ENERGY[stateRef.current] || STATE_ENERGY.idle;
      const lvl = stateRef.current === "listening" ? levelRef.current : 0;

      ctx.clearRect(0, 0, size, size);
      ctx.save();

      if (light) {
        // QUARTZ. The dark-room trick doesn't transfer: additive light on a
        // pale page averages to washed grey, and three lobes left to their own
        // devices read as a stain floating on an empty plate.
        //
        // So on light the orb is built as a sphere first and animated second.
        // A dense radial body fills the disc edge to edge and guarantees it
        // always reads as one object; the lobes then tint *within* that body
        // rather than being the whole of it. Colour lives across the whole
        // sphere, so no instant of the animation can look like a smudge.
        ctx.beginPath();
        ctx.arc(cx, cy, R - 0.5, 0, Math.PI * 2);
        ctx.clip();

        const body = ctx.createRadialGradient(cx, cy - R * 0.12, R * 0.05, cx, cy, R);
        body.addColorStop(0, colors[0] + "A8");
        body.addColorStop(0.55, colors[0] + "5E");
        body.addColorStop(1, colors[0] + "1C");
        ctx.fillStyle = body;
        ctx.fillRect(0, 0, size, size);

        // Wide and soft: these are currents inside the sphere, not objects on
        // top of it.
        drawLobes(e, lvl, "72", "2A", 1.5);

        // A highlight along the top-left sells it as a sphere rather than a
        // flat disc — the one piece of skeuomorphism in the building, and it
        // is doing real work.
        const gloss = ctx.createLinearGradient(cx - R * 0.5, cy - R, cx + R * 0.4, cy + R * 0.7);
        gloss.addColorStop(0, "rgba(255,255,255,0.62)");
        gloss.addColorStop(0.4, "rgba(255,255,255,0.10)");
        gloss.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = gloss;
        ctx.fillRect(0, 0, size, size);

        // …and a barely-there shadowed rim, so the sphere sits in the page
        // instead of hovering on it. Kept faint: any heavier and it stacks
        // with the SVG track ring outside and the pair reads as a plate rim.
        const rim = ctx.createRadialGradient(cx, cy, R * 0.72, cx, cy, R);
        rim.addColorStop(0, "rgba(20,22,27,0)");
        rim.addColorStop(1, "rgba(20,22,27,0.055)");
        ctx.fillStyle = rim;
        ctx.fillRect(0, 0, size, size);

        // No canvas edge stroke on light — the SVG track ring already draws
        // the boundary, and two concentric strokes is one too many.
        ctx.restore();
        return;
      }

      // OBSIDIAN. Light in a dark room: additive, no disc, no edge to speak of.
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      core.addColorStop(0, colors[0] + "3A");
      core.addColorStop(0.62, colors[0] + "14");
      core.addColorStop(1, "transparent");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.98, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalCompositeOperation = "lighter";
      drawLobes(e, lvl, "B8", "4E");
      ctx.globalCompositeOperation = "source-over";
      ctx.restore();

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

  // How much of the ring this state lights up. Idle is genuinely nothing —
  // and "nothing" has to mean a hidden stroke, not a zero-length dash: a dash
  // of length 0 with a round linecap still paints its cap, which is where the
  // stray dot at twelve o'clock was coming from.
  const arc =
    state === "thinking" ? 0.22 :
    state === "listening" ? 0.30 + level * 0.55 :
    state === "speaking" ? 0.82 :
    state === "error" ? 1 : 0;

  return (
    <div className="orb-wrap" data-state={state} style={{ width: size, height: size }}>
      <span className="orb-halo" />
      <canvas ref={canvasRef} className="orb-canvas" style={{ width: size, height: size }} />
      <svg className="orb-ring" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2} cy={size / 2} r={ringR}
          stroke="var(--ink-a06)" strokeWidth="2"
        />
        <circle
          cx={size / 2} cy={size / 2} r={ringR}
          stroke={state === "error" ? "var(--red)" : "var(--accent)"}
          strokeWidth="2.5"
          strokeDasharray={`${circumference * arc} ${circumference}`}
          style={{
            transform: "rotate(-90deg)",
            transformOrigin: "center",
            opacity: arc === 0 ? 0 : 1,
            transition: "stroke-dasharray var(--dur-2) var(--ease-out), stroke var(--dur-2) ease, opacity var(--dur-2) ease",
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
