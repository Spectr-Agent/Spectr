"use client";

import { useSyncExternalStore } from "react";

// One shared source of truth for "should things move?". It follows the visitor's
// system setting, and also accepts a manual override so the prototype shell's
// "Reduced motion" toggle (a postMessage) and ?rm=1 or ?rm=0 in the address
// still work. The result is mirrored to a class on <html> that the CSS reads.

type Listener = () => void;
const listeners = new Set<Listener>();
let system = false;
let override: boolean | null = null;
let started = false;

const current = () => override ?? system;

function apply() {
  document.documentElement.classList.toggle("rm", current());
  listeners.forEach((listener) => listener());
}

/** Manual switch. Pass null to go back to the system setting. */
export function setReducedMotionOverride(on: boolean | null) {
  override = on;
  apply();
}

function start() {
  if (started) return;
  started = true;
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  system = query.matches;
  const param = new URLSearchParams(window.location.search).get("rm");
  if (param === "1") override = true;
  if (param === "0") override = false;
  query.addEventListener("change", (event) => {
    system = event.matches;
    apply();
  });
  window.addEventListener("message", (event) => {
    // Only the page itself or the page that embeds it may flip the switch.
    if (event.source !== window && event.source !== window.parent) return;
    const data = event.data as { spectr?: string; on?: unknown } | null;
    if (data && data.spectr === "rm") setReducedMotionOverride(Boolean(data.on));
  });
  apply();
}

function subscribe(listener: Listener) {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, current, () => false);
}
