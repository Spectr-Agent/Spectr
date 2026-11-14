"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isAction, type MessageStep, type Script } from "@/lib/thread";
import { useReducedMotion } from "./useReducedMotion";

export interface ShownMessage extends MessageStep {
  id: number;
  /** False when reduced motion is on: the caption appears without the bounce. */
  animate: boolean;
}

export interface PlayOptions {
  /** Runs when a line from Spectr appears. */
  onShow?: (step: MessageStep) => void;
  /** Runs for a scripted action. Return when it has finished. */
  onAction?: (action: string, alive: () => boolean, instant: boolean) => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The engine behind every call. `play` shows a script one line at a time, with a
 * pause before Spectr speaks. Starting a new `play` cancels the one in progress:
 * each run holds a token and stops as soon as it is no longer the newest.
 */
export function useThread() {
  const [items, setItems] = useState<ShownMessage[]>([]);
  const [typing, setTyping] = useState(false);
  const token = useRef(0);
  const nextId = useRef(0);
  const reduced = useReducedMotion();
  const reducedNow = useRef(reduced);

  useEffect(() => {
    reducedNow.current = reduced;
  }, [reduced]);

  // Stop whatever is running when the component goes away.
  useEffect(
    () => () => {
      token.current += 1;
    },
    [],
  );

  const add = useCallback((step: MessageStep, animate: boolean) => {
    setItems((previous) => [...previous, { ...step, id: nextId.current++, animate }]);
  }, []);

  const play = useCallback(
    async (script: Script, options: PlayOptions = {}) => {
      token.current += 1;
      const mine = token.current;
      const alive = () => token.current === mine;
      setItems([]);
      setTyping(false);

      for (const step of script) {
        if (!alive()) return;
        const instant = reducedNow.current;
        if (isAction(step)) {
          await options.onAction?.(step.action, alive, instant);
          continue;
        }
        if (instant) {
          add(step, false);
          options.onShow?.(step);
          continue;
        }
        if (step.from === "me") {
          await sleep(step.pre ?? 600);
          if (!alive()) return;
          add(step, true);
          await sleep(step.after ?? 600);
        } else {
          setTyping(true);
          await sleep(step.typing ?? 900);
          if (!alive()) return;
          setTyping(false);
          add(step, true);
          options.onShow?.(step);
          await sleep(step.after ?? 450);
        }
      }
    },
    [add],
  );

  return { items, typing, play };
}

export type Thread = ReturnType<typeof useThread>;
