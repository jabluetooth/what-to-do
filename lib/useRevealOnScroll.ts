"use client";

import { useEffect, useRef, useState } from "react";

/**
 * True once, the first time the returned ref's element scrolls into view — for playing a plain
 * mount-triggered CSS animation (e.g. the stack-card stagger in app/page.tsx) on scroll instead,
 * for content far enough down the page that it would already be finished by the time a visitor
 * reaches it. Fires only once and disconnects immediately after: a landing section re-animating
 * every time it's scrolled past would read as distracting, not as an entrance.
 *
 * Deliberately doesn't hide content (e.g. via a default opacity-0 class) while `visible` is still
 * false — this covers the initial SSR/pre-hydration render and any environment without
 * IntersectionObserver, so the section is always real, visible content first and foremost, with
 * the reveal purely as a progressive-enhancement flourish layered on top via the animation's own
 * `backwards` fill-mode once it's attached.
 */
export function useRevealOnScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, visible } as const;
}
