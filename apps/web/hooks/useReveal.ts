"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

/**
 * One shot scroll reveal. `shown` turns true the first time the element is
 * about 18 percent visible and stays true. With reduced motion it is true at once.
 * `onReveal` runs once, at that moment.
 */
export function useReveal<T extends HTMLElement>(onReveal?: () => void) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  const reduced = useReducedMotion();
  const callback = useRef(onReveal);

  useEffect(() => {
    callback.current = onReveal;
  });

  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          callback.current?.();
          observer.disconnect();
        }
      },
      { threshold: 0.18 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);

  return { ref, shown: seen || reduced };
}
