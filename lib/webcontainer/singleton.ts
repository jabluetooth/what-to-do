import type { WebContainer } from "@webcontainer/api";

/**
 * WebContainers allow only one booted instance per browsing tab — but React 19's dev-mode
 * StrictMode double-invokes effects, which calls WebContainer.boot() twice in quick succession
 * and hits that constraint (confirmed live: "Only a single WebContainer instance can be
 * booted"). A module-level singleton promise means every caller in this tab — including both
 * StrictMode invocations — shares the same boot call instead of racing two of them.
 */
let bootPromise: Promise<WebContainer> | null = null;

export function getWebContainer(): Promise<WebContainer> {
  if (!bootPromise) {
    bootPromise = import("@webcontainer/api").then(({ WebContainer }) => WebContainer.boot());
  }
  return bootPromise;
}

export async function teardownWebContainer(): Promise<void> {
  if (!bootPromise) return;
  const instance = await bootPromise;
  bootPromise = null;
  instance.teardown();
}
