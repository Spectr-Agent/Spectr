"use client";

import Image from "next/image";
import { useEffect, useRef, type CSSProperties } from "react";
import { copy } from "@/content/copy";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { ShownMessage, Thread } from "@/hooks/useThread";
import { images } from "@/lib/images";
import { Shot } from "./Shot";

const isCard = (message: ShownMessage) => Boolean(message.shot || message.file || message.preview);

function Content({ message }: { message: ShownMessage }) {
  const { phone } = copy;
  if (message.shot) {
    return (
      <div className="card shotc">
        <Shot kind={message.shot} />
      </div>
    );
  }
  if (message.file) {
    return (
      <div className="card filec">
        <div className="fi">{phone.pdf}</div>
        <div>
          <b>{message.file}</b>
          <small>{message.size}</small>
        </div>
      </div>
    );
  }
  if (message.preview) {
    const p = message.preview;
    return (
      <div className="card prev">
        <small>
          {phone.previewTo} {p.to}
        </small>
        <small>
          {phone.previewSubject} {p.subject}
        </small>
        <p>{p.body}</p>
        <div className="chip">{p.file}</div>
      </div>
    );
  }
  return <div className="bub">{message.text}</div>;
}

interface PhoneThreadProps {
  thread: Thread;
  /** Slide the phone in from the side. Used when a use case card changes. */
  swap?: boolean;
  /** Which way the swap comes from: 1 is from the right, -1 from the left. */
  direction?: 1 | -1;
}

/** An iPhone showing a Messages thread that fills in as its script plays. */
export function PhoneThread({ thread, swap = false, direction = 1 }: PhoneThreadProps) {
  const { items, typing, draft, started } = thread;
  const scroller = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { phone } = copy;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [items.length, typing, reduced]);

  return (
    <div className={`phone${swap ? " swap" : ""}`} style={{ "--dir": direction } as CSSProperties}>
      <div className="pscreen">
        <div className="isl" />
        <div className="sbar">
          <span>{phone.time}</span>
          <span className="sig" aria-hidden="true">
            <i />
            <i />
            <i />
            <b />
          </span>
        </div>
        <div className="mhead">
          <span className="back" aria-hidden="true">
            &#8249;
          </span>
          <div className="who">
            <Image src={images.favicon} alt="" width={40} height={40} sizes="40px" />
            <span>{phone.name}</span>
          </div>
        </div>
        <div className="thread" ref={scroller}>
          {started ? <div className="stamp">{phone.stamp}</div> : null}
          {items.map((message, index) => {
            const next = items[index + 1];
            const sameRun = next && !isCard(next) && next.from === message.from;
            const tail = !isCard(message) && !sameRun;
            const classes = ["msg", message.from === "me" ? "me" : "bot", message.shot ? "shotm" : "", message.preview ? "wide" : "", tail ? "tail" : ""]
              .filter(Boolean)
              .join(" ");
            return (
              <div key={message.id} className={classes} style={message.animate ? undefined : { animation: "none" }}>
                <Content message={message} />
              </div>
            );
          })}
          {typing ? (
            <div className="typing" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          ) : null}
        </div>
        <div className="comp">
          <div className="plus" aria-hidden="true">
            +
          </div>
          <div className={`field${draft ? " has" : ""}`}>
            <span className="txt">{draft}</span>
            <span className="send" aria-hidden="true">
              &#8593;
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
