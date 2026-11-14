"use client";

import Image from "next/image";
import { useCallback, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { caseScripts, copy } from "@/content/copy";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useStartOnReveal } from "@/hooks/useStartOnReveal";
import { useThread } from "@/hooks/useThread";
import { images } from "@/lib/images";
import { PhoneThread } from "./PhoneThread";
import { Reveal } from "./Reveal";

const SWIPE_DISTANCE = 45;

/** A carousel of example people. Each card types its own thread into the phone. */
export function UseCases() {
  const { cases, a11y } = copy;
  const thread = useThread();
  const reduced = useReducedMotion();
  const [current, setCurrent] = useState(0);
  const [swap, setSwap] = useState({ key: 0, on: false, direction: 1 as 1 | -1 });
  const currentRef = useRef(0);
  const swipeStart = useRef<number | null>(null);
  const { play } = thread;
  const last = cases.cards.length - 1;

  const runCase = useCallback((index: number) => void play(caseScripts[index]!, { typeUser: true }), [play]);
  const onReveal = useStartOnReveal(() => runCase(currentRef.current), 500);

  const go = (index: number) => {
    if (index < 0 || index > last || index === currentRef.current) return;
    const direction = index >= currentRef.current ? 1 : -1;
    currentRef.current = index;
    setCurrent(index);
    setSwap((previous) => ({ key: previous.key + 1, on: !reduced, direction }));
    runCase(index);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") go(currentRef.current - 1);
    if (event.key === "ArrowRight") go(currentRef.current + 1);
  };
  const onPointerDown = (event: PointerEvent) => {
    swipeStart.current = event.clientX;
  };
  const onPointerUp = (event: PointerEvent) => {
    if (swipeStart.current === null) return;
    const distance = event.clientX - swipeStart.current;
    swipeStart.current = null;
    if (Math.abs(distance) > SWIPE_DISTANCE) go(currentRef.current + (distance < 0 ? 1 : -1));
  };

  return (
    <section id="cases" className="cases">
      <div className="wrap">
        <Reveal onReveal={onReveal}>
          <span className="eyebrow">{cases.eyebrow}</span>
          <h2>{cases.title}</h2>
          <p className="lead">{cases.lead}</p>
        </Reveal>
        <div className="casegrid">
          <div className="carwrap" tabIndex={0} aria-label={a11y.carousel} onKeyDown={onKeyDown}>
            <div className="car" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => (swipeStart.current = null)}>
              {cases.cards.map((card, index) => {
                const offset = index - current;
                const distance = Math.abs(offset);
                const style = { "--o": offset, "--a": Math.min(distance, 2), zIndex: 10 - distance } as CSSProperties;
                return (
                  <div key={card.role} className={`ccard${offset === 0 ? " act" : ""}`} data-a={distance} style={style} onClick={() => go(index)}>
                    <div className="cart">
                      <div className="cmasc">
                        <span className="disc" />
                        <Image src={images[card.image]} alt={card.alt} sizes="200px" />
                      </div>
                      <span className="role">{card.role}</span>
                      <h3>{card.title}</h3>
                      <div className="ex">{card.example}</div>
                      <div className="traits">
                        {card.traits.map((trait) => (
                          <span key={trait}>{trait}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="ccontrols">
              <button className="arrow" aria-label={a11y.previous} disabled={current === 0} onClick={() => go(current - 1)}>
                &#8249;
              </button>
              <div className="dots">
                {cases.cards.map((card, index) => (
                  <button key={card.role} aria-label={card.role} className={index === current ? "on" : undefined} onClick={() => go(index)} />
                ))}
              </div>
              <button className="arrow" aria-label={a11y.next} disabled={current === last} onClick={() => go(current + 1)}>
                &#8250;
              </button>
            </div>
          </div>
          <Reveal className="casephone" onReveal={onReveal}>
            <div>
              <PhoneThread key={swap.key} thread={thread} swap={swap.on} direction={swap.direction} />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
