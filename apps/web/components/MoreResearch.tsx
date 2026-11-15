"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { copy } from "@/content/copy";
import { useFactsPerPage } from "@/hooks/useFactsPerPage";
import { Eyebrow } from "./Eyebrow";
import { Reveal } from "./Reveal";
import { Source } from "./Source";

const SWIPE_DISTANCE = 45;

/** The rest of the numbers, a few at a time in a carousel, each with its source. */
export function MoreResearch() {
  const { more, a11y } = copy;
  const size = useFactsPerPage();
  const pageCount = Math.ceil(more.facts.length / size);
  const [state, setState] = useState({ page: 0, direction: 1 });
  const swipeStart = useRef<number | null>(null);
  const page = Math.min(state.page, pageCount - 1);
  const facts = more.facts.slice(page * size, page * size + size);

  const go = (index: number) => {
    if (index < 0 || index >= pageCount || index === page) return;
    setState({ page: index, direction: index > page ? 1 : -1 });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") go(page - 1);
    if (event.key === "ArrowRight") go(page + 1);
  };
  const onPointerDown = (event: PointerEvent) => {
    swipeStart.current = event.clientX;
  };
  const onPointerUp = (event: PointerEvent) => {
    if (swipeStart.current === null) return;
    const distance = event.clientX - swipeStart.current;
    swipeStart.current = null;
    if (Math.abs(distance) > SWIPE_DISTANCE) go(page + (distance < 0 ? 1 : -1));
  };

  return (
    <section id="more" className="slide more">
      <div className="wrap">
        <Reveal>
          <Eyebrow>{more.eyebrow}</Eyebrow>
          <h2>{more.title}</h2>
        </Reveal>
        <div className="factwrap" tabIndex={0} aria-label={a11y.research} onKeyDown={onKeyDown}>
          <div className="factview" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => (swipeStart.current = null)}>
            <ul key={`${size}-${page}`} className="facts" style={{ "--dir": state.direction } as React.CSSProperties}>
              {facts.map((fact) => (
                <li key={fact.text}>
                  <p>{fact.text}</p>
                  <Source name={fact.source} link={fact.link} />
                </li>
              ))}
            </ul>
          </div>
          <div className="ccontrols">
            <button className="arrow" aria-label={a11y.previous} disabled={page === 0} onClick={() => go(page - 1)}>
              &#8249;
            </button>
            <div className="dots">
              {Array.from({ length: pageCount }, (_, index) => (
                <button key={index} aria-label={`${index + 1} of ${pageCount}`} className={index === page ? "on" : undefined} onClick={() => go(index)} />
              ))}
            </div>
            <button className="arrow" aria-label={a11y.next} disabled={page === pageCount - 1} onClick={() => go(page + 1)}>
              &#8250;
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
