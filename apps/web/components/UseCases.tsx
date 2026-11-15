"use client";

import Image from "next/image";
import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { copy } from "@/content/copy";
import { images } from "@/lib/images";
import { Eyebrow } from "./Eyebrow";
import { Icon } from "./Icon";
import { Reveal } from "./Reveal";

const SWIPE_DISTANCE = 45;

/** A carousel of example people. Each card shows how Spectr talks to that person. */
export function UseCases() {
  const { cases, a11y } = copy;
  const [current, setCurrent] = useState(0);
  const currentRef = useRef(0);
  const swipeStart = useRef<number | null>(null);
  const last = cases.cards.length - 1;

  const go = (index: number) => {
    if (index < 0 || index > last || index === currentRef.current) return;
    currentRef.current = index;
    setCurrent(index);
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
    <section id="cases" className="slide cases">
      <div className="wrap">
        <Reveal>
          <Eyebrow>{cases.eyebrow}</Eyebrow>
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
                        <Image src={images[card.image]} alt={card.alt} sizes="200px" />
                      </div>
                      <span className="role">
                        <Icon name={card.icon} />
                        {card.role}
                      </span>
                      <h3>{card.title}</h3>
                      <div className="ex">{card.example}</div>
                      <div className="ex reply">{card.reply}</div>
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
        </div>
      </div>
    </section>
  );
}
