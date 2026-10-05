"use client";

import Image from "next/image";
import { Kicker, LineReveal, Rise } from "@/components/fx/Reveal";

/** Opens the production EAS channel in Expo Go, so it always serves the latest mobile update. Same URL
 *  as WhatToDo-mobile's README QR (public/qr-expo-go.png encodes it). */
const EXPO_GO_URL =
  "exp://u.expo.dev/4a497563-25ce-472d-b169-52634ae6b19d?channel-name=production&runtime-version=exposdk%3A57.0.0";

/** Presents the WhatToDo-mobile companion app: a scan-to-try QR on desktop, and a direct
 *  "Open in Expo Go" link on phones, where scanning your own screen isn't an option. */
export default function MobileSection() {
  return (
    <section id="mobile" className="mx-auto w-full max-w-6xl px-5 py-28 sm:px-10">
      <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <Kicker>Mobile</Kicker>
          <LineReveal
            lines={["Roll on the go.", <span key="b" className="text-muted">Build from your phone.</span>]}
            className="mt-5 font-display text-6xl uppercase leading-[0.9] sm:text-7xl"
          />
          <Rise delay={0.2}>
            <p className="mt-8 max-w-md text-muted">
              Spec it, build it and push it to GitHub without leaving your phone. Projects sync with your
              History here.
            </p>
          </Rise>
          <Rise delay={0.3}>
            <ol className="mt-6 space-y-2 text-sm text-muted">
              <li>
                <span className="font-mono text-accent">01</span>{" "}
                Get{" "}
                <a
                  href="https://expo.dev/go"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground underline-offset-4 hover:text-accent hover:underline"
                >
                  Expo Go
                </a>{" "}
                (free, iOS and Android).
              </li>
              <li>
                <span className="font-mono text-accent">02</span>{" "}
                <span className="hidden lg:inline">Scan the code with your phone&apos;s camera.</span>
                <span className="lg:hidden">Tap Open in Expo Go below.</span>
              </li>
              <li>
                <span className="font-mono text-accent">03</span> Sign in with GitHub inside the app.
              </li>
            </ol>
          </Rise>
          <Rise delay={0.35}>
            <a
              href={EXPO_GO_URL}
              className="mt-8 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-5 py-3 text-sm font-medium transition-colors hover:text-accent lg:hidden"
            >
              Open in Expo Go
              <span aria-hidden="true">→</span>
            </a>
          </Rise>
        </div>

        <Rise delay={0.15} className="hidden lg:block">
          <figure className="mx-auto w-fit rounded-3xl border border-line bg-surface p-6 text-center">
            <div className="rounded-2xl bg-white p-3">
              <Image
                src="/qr-expo-go.png"
                alt="QR code that opens What To Do in Expo Go"
                width={220}
                height={220}
                className="h-[220px] w-[220px]"
              />
            </div>
            <figcaption className="mt-4 font-mono text-xs uppercase tracking-wider text-muted">
              Scan to try in Expo Go
            </figcaption>
          </figure>
        </Rise>
      </div>
    </section>
  );
}
