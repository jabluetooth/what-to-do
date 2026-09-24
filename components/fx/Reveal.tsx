"use client";

import { motion } from "framer-motion";

/** One easing for the whole site: fast out, long settle. */
export const EASE = [0.16, 1, 0.3, 1] as const;

const VIEWPORT = { once: true, margin: "-10% 0px" } as const;

/** Headline reveal — each line sits in its own mask and rises from behind its baseline, so lines
 *  land one after another instead of the whole block fading up together. */
export function LineReveal({
  lines,
  as: Tag = "h2",
  className = "",
  delay = 0,
  inView = true,
}: {
  lines: React.ReactNode[];
  as?: "h1" | "h2" | "h3" | "p";
  className?: string;
  delay?: number;
  inView?: boolean;
}) {
  return (
    <Tag className={className}>
      {lines.map((line, i) => (
        <span key={i} className="-mb-[0.08em] block overflow-hidden pb-[0.08em]">
          <motion.span
            className="block"
            initial={{ y: "110%", rotate: 3 }}
            {...(inView ? { whileInView: { y: 0, rotate: 0 }, viewport: VIEWPORT } : { animate: { y: 0, rotate: 0 } })}
            transition={{ duration: 0.9, ease: EASE, delay: delay + i * 0.08 }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </Tag>
  );
}

export function Rise({
  children,
  className,
  delay = 0,
  y = 24,
  inView = true,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  inView?: boolean;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      {...(inView ? { whileInView: { opacity: 1, y: 0 }, viewport: VIEWPORT } : { animate: { opacity: 1, y: 0 } })}
      transition={{ duration: 0.8, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Small uppercase mono label that sits above every section headline. */
export function Kicker({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-muted ${className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
      {children}
    </p>
  );
}
