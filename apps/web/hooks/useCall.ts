"use client";

import { useCallback, useState } from "react";
import type { SceneKind, Script } from "@/lib/thread";
import { useThread, type PlayOptions } from "./useThread";

/** A FaceTime call: the spoken lines, plus whatever the Mac's screen is showing. */
export function useCall() {
  const thread = useThread();
  const [scene, setScene] = useState<SceneKind | null>(null);
  const { play: playThread } = thread;

  const play = useCallback(
    (script: Script, options: PlayOptions = {}) => {
      setScene(null);
      return playThread(script, {
        ...options,
        onShow: (step) => {
          if (step.scene) setScene(step.scene);
          options.onShow?.(step);
        },
      });
    },
    [playThread],
  );

  return { ...thread, scene, play };
}

export type Call = ReturnType<typeof useCall>;
