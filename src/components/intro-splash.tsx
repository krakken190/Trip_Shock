"use client";

import { useEffect, useState } from "react";
import { BedDouble, MapPin, Plane, Zap } from "lucide-react";
import { INTRO_COOKIE } from "@/lib/intro";

const PLAY_MS = 2600;
const FADE_MS = 450;

// Route joints double as stop positions, so the markers sit exactly on the curve.
const STOPS = [
  { x: 230, y: 198, Icon: Plane },
  { x: 400, y: 168, Icon: BedDouble },
  { x: 560, y: 128, Icon: MapPin },
] as const;
const ROUTE = "M -20 214 C 80 214, 170 206, 230 198 C 300 189, 340 182, 400 168 C 460 154, 500 140, 560 128 C 650 110, 740 92, 820 80";

/**
 * Brand intro, once per browser session: a trip route draws itself, a shock
 * pulse hits it, and the TripShock mark settles in before the app fades up.
 *
 * The server omits it once the session cookie is set; CSS hides it under
 * reduced motion; automation skips it. `?intro` in the URL forces it to play
 * (e.g. for demo recordings). Click or any key skips it.
 */
export function IntroSplash({ seen }: { seen: boolean }) {
  const [phase, setPhase] = useState<"play" | "exit" | "done">(seen ? "done" : "play");
  const [forced, setForced] = useState(false);

  useEffect(() => {
    const force = /[?&]intro(=|&|$)/.test(window.location.search);
    if (seen && !force) return;
    document.cookie = `${INTRO_COOKIE}=1; path=/; SameSite=Lax`;
    if (force) {
      setForced(true);
      setPhase("play");
    } else if (navigator.webdriver || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase("done");
      return;
    }
    const exit = window.setTimeout(() => setPhase("exit"), PLAY_MS);
    const skip = () => setPhase((p) => (p === "play" ? "exit" : p));
    window.addEventListener("keydown", skip);
    return () => {
      window.clearTimeout(exit);
      window.removeEventListener("keydown", skip);
    };
  }, [seen]);

  useEffect(() => {
    if (phase !== "exit") return;
    const t = window.setTimeout(() => setPhase("done"), FADE_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  if (phase === "done") return null;

  return (
    <div
      className="intro"
      data-phase={phase}
      data-force={forced || undefined}
      role="presentation"
      aria-hidden
      onClick={() => setPhase("exit")}
    >
      <svg className="intro-scene" viewBox="0 0 800 300" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="intro-glow" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="intro-burst">
            <stop offset="0" stopColor="#fef08a" />
            <stop offset="0.35" stopColor="#facc15" stopOpacity="0.85" />
            <stop offset="1" stopColor="#facc15" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g className="intro-route">
          <path d={ROUTE} pathLength={1} className="intro-line" filter="url(#intro-glow)" />
          {STOPS.map(({ x, y, Icon }, i) => (
            <g key={i} className="intro-stop" style={{ animationDelay: `${0.28 + i * 0.16}s`, transformOrigin: `${x}px ${y}px` }}>
              <circle cx={x} cy={y} r={6.5} className="intro-dot" />
              <Icon x={x - 14} y={y - 46} width={28} height={28} strokeWidth={1.75} className="intro-icon" />
            </g>
          ))}
        </g>

        <circle cx={STOPS[1].x} cy={STOPS[1].y} r={70} fill="url(#intro-burst)" className="intro-burst" />
        <circle cx={STOPS[1].x} cy={STOPS[1].y} r={40} className="intro-ring" />
        <circle cx={STOPS[1].x} cy={STOPS[1].y} r={40} className="intro-ring intro-ring-2" />
      </svg>

      <div className="intro-mark">
        <span className="intro-tile">
          <span className="intro-ripple" />
          <span className="intro-ripple intro-ripple-2" />
          <Zap className="intro-bolt" strokeWidth={2} />
        </span>
        <span className="intro-word">TripShock</span>
      </div>
    </div>
  );
}
