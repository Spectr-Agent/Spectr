"use client";

import type { CSSProperties } from "react";
import { copy } from "@/content/copy";
import type { ShownMessage } from "@/hooks/useThread";
import type { SceneKind } from "@/lib/thread";
import { ScreenView } from "./Scene";

interface CallPhoneProps {
  call: { items: ShownMessage[]; typing: boolean; scene: SceneKind | null };
  /** The Mac screen is in dark mode. Only used by the demo. */
  dark?: boolean;
  /** Slide the phone in from the side. Used when a use case card changes. */
  swap?: boolean;
  /** Which way the swap comes from: 1 is from the right, -1 from the left. */
  direction?: 1 | -1;
}

/** An iPhone on a FaceTime call. The video is the Mac's screen, and what is said shows as captions. */
export function CallPhone({ call, dark = false, swap = false, direction = 1 }: CallPhoneProps) {
  const { call: words } = copy;
  const recent = call.items.slice(-2);
  return (
    <div className={`phone${swap ? " swap" : ""}`} style={{ "--dir": direction } as CSSProperties}>
      <div className="pscreen fscreen">
        <div className="isl" />
        <div className="sbar">
          <span>{words.time}</span>
          <span className="sig" aria-hidden="true">
            <i />
            <i />
            <i />
            <b />
          </span>
        </div>
        <div className="fhead">
          <b>{words.name}</b>
          <small>{words.sub}</small>
        </div>
        <div className="video">
          <ScreenView scene={call.scene} dark={dark} />
          <div className="caps" aria-live="polite">
            {recent.map((message) => (
              <div key={message.id} className={`cap${message.from === "me" ? " you" : ""}`} style={message.animate ? undefined : { animation: "none" }}>
                <small>{message.from === "me" ? words.you : words.spectr}</small>
                {message.text}
              </div>
            ))}
            {call.typing ? (
              <div className="cap" aria-hidden="true">
                <small>{words.spectr}</small>
                <span className="wave">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            ) : null}
          </div>
        </div>
        <div className="fctl" aria-hidden="true">
          <span>
            <svg viewBox="0 0 24 24">
              <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z" />
            </svg>
          </span>
          <span className="end">
            <svg viewBox="0 0 24 24">
              <path d="M12 9c-3.3 0-6.3 1-8.4 2.7-.5.5-.5 1.3 0 1.8l1.6 1.6c.4.4 1 .5 1.5.2l2-1.2c.3-.2.5-.5.5-.9V12c1.2-.4 2.6-.4 3.8 0v1.2c0 .4.2.7.5.9l2 1.2c.5.3 1.1.2 1.5-.2l1.6-1.6c.5-.5.5-1.3 0-1.8C18.3 10 15.3 9 12 9z" />
            </svg>
          </span>
          <span>
            <svg viewBox="0 0 24 24">
              <path d="M4 6h3l1.5-2h7L17 6h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm8 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
            </svg>
          </span>
        </div>
      </div>
    </div>
  );
}
