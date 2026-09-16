"use client";

import { useEffect, useState } from "react";

/** Any JS-driven animation loop (setInterval/setTimeout/rAF, not CSS transitions/animations) must
 *  check this itself — globals.css's `prefers-reduced-motion` kill-switch only collapses CSS
 *  transition/animation durations, so it can't reach a plain timer loop. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    // One-time sync from a browser-only API that can't be read during SSR (no window) or as lazy
    // useState init for the same reason — the change listener below handles every update after.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReduced(query.matches);
    const handleChange = () => setReduced(query.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);
  return reduced;
}
