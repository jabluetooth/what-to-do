"use client";

import { motion } from "framer-motion";
import { EASE, Kicker, LineReveal } from "@/components/fx/Reveal";

/** Every line here is a real, verifiable behavior of the shipped pipeline, not an aspiration. */
const CAPABILITIES = [
  { title: "No signup", body: "The whole pipeline works as a guest." },
  { title: "Boot-tested", body: "Installs and runs in-browser before you download." },
  { title: "CLI or browser", body: "npx create-whattodo drives the same pipeline." },
  { title: "Connected UI", body: "The generated frontend really calls its own API." },
  { title: "Self-expiring", body: "Idle guest data deletes itself." },
  { title: "GitHub push", body: "Sign in once, get a repo per project." },
];

export default function CapabilitiesSection() {
  return (
    <section id="capabilities" className="mx-auto w-full max-w-6xl px-5 py-28 sm:px-10">
      <Kicker>Capabilities</Kicker>
      <LineReveal
        lines={["True today,", <span key="b" className="text-muted">not someday.</span>]}
        className="mt-5 font-display text-6xl uppercase leading-[0.9] sm:text-8xl"
      />

      <ul className="mt-16 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map((item, index) => (
          <motion.li
            key={item.title}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-8% 0px" }}
            transition={{ duration: 0.7, ease: EASE, delay: (index % 3) * 0.08 }}
            className="group border-t border-line py-8 sm:pr-8"
          >
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-line transition-all duration-300 group-hover:scale-150 group-hover:bg-accent" aria-hidden="true" />
              <p className="font-display text-3xl uppercase transition-colors duration-300 group-hover:text-accent">{item.title}</p>
            </div>
            <p className="mt-2 pl-5 text-sm text-muted">{item.body}</p>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}
