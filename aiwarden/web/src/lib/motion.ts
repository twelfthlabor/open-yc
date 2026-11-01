import { useEffect, useRef, useState } from "react";

/** True when the browser can animate and the user has not asked for reduced motion. jsdom has no matchMedia. */
export function motionOK(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const NUM = /\d[\d,]*(?:\.\d+)?/;

/** The first number in a formatted value, scaled by t (0..1), with the same decimals and thousands separators. */
export function tweenText(text: string, t: number): string {
  const m = NUM.exec(text);
  if (!m) return text;
  const raw = m[0];
  const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
  const v = Number(raw.replace(/,/g, "")) * Math.max(0, Math.min(1, t));
  const s = raw.includes(",") ? v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : v.toFixed(decimals);
  return text.slice(0, m.index) + s + text.slice(m.index + raw.length);
}

const ease = (t: number) => 1 - (1 - t) ** 3;

/** Counts a formatted value up from zero the first time it mounts; later changes swap in place. */
export function useCountUp(text: string, ms = 900): string {
  const [shown, setShown] = useState(() => (motionOK() && NUM.test(text) ? tweenText(text, 0) : text));
  const first = useRef(true);
  useEffect(() => {
    if (!first.current || !motionOK() || !NUM.test(text)) {
      setShown(text);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setShown(tweenText(text, ease(t)));
      if (t < 1) raf = requestAnimationFrame(tick);
      else first.current = false; // only a finished count-up counts: StrictMode's remount replays it
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, ms]);
  return shown;
}
