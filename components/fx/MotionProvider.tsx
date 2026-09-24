"use client";

import { MotionConfig } from "framer-motion";

/** reducedMotion="user" makes every framer-motion animation on the site honor the OS
 *  prefers-reduced-motion setting (transforms are skipped, opacity still fades) — the JS-driven
 *  counterpart to globals.css's CSS kill-switch, which can't reach motion's own animations. */
export default function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
