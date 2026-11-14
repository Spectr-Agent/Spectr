"use client";

import { useCallback, useEffect, useRef } from "react";
import { useReducedMotion } from "./useReducedMotion";

/**
 * Starts something once, a short while after a section first scrolls into view.
 * With reduced motion it starts straight away. If the setting changes later it
 * runs `start` again so the content matches the new setting.
 * Pass the returned function as `onReveal` to <Reveal>.
 */
export function useStartOnReveal(start: () => void, delayMs: number) {
  const reduced = useReducedMotion();
  const started = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(start);

  useEffect(() => {
    latest.current = start;
  });

  const onReveal = useCallback(() => {
    if (started.current) return;
    started.current = true;
    timer.current = setTimeout(() => latest.current(), delayMs);
  }, [delayMs]);

  useEffect(() => {
    if (reduced || started.current) {
      started.current = true;
      clearTimeout(timer.current);
      latest.current();
    }
  }, [reduced]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return onReveal;
}
