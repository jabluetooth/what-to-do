"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus behavior for a plain `role="dialog"` overlay (the native <dialog> element would give this
 * for free, but these are styled divs): moves focus into the dialog on open, traps Tab/Shift+Tab
 * inside it so it can't leak to the page behind the backdrop, restores focus to whatever triggered
 * it on close, and closes on Escape. Attach the returned ref to the dialog's role="dialog" element
 * with tabIndex={-1} — focusing the dialog container itself (per the WAI-ARIA APG) rather than
 * guessing which inner control deserves initial focus.
 */
export function useModalDialog(open: boolean, onClose: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    containerRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      const container = containerRef.current;
      if (e.key !== "Tab" || !container) return;

      const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      triggerRef.current?.focus();
    };
  }, [open, onClose]);

  return containerRef;
}
