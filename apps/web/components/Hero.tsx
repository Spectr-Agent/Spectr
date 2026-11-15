"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { copy } from "@/content/copy";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useStartOnReveal } from "@/hooks/useStartOnReveal";
import { images } from "@/lib/images";
import { Eyebrow } from "./Eyebrow";
import { Picture } from "./Picture";
import { Reveal } from "./Reveal";

export function Hero() {
  const { hero } = copy;
  const reduced = useReducedMotion();
  const [pose, setPose] = useState<"working" | "success">("working");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The mascot works for a moment, then swaps to the success pose.
  const run = useCallback(() => {
    clearTimeout(timer.current);
    setPose(reduced ? "success" : "working");
    if (!reduced) timer.current = setTimeout(() => setPose("success"), 2600);
  }, [reduced]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Starts when the hero is in view, which on a fresh load is at once.
  const onReveal = useStartOnReveal(run, 500);

  return (
    <header className="slide hero dark" id="top">
      <Picture fill label={hero.picture} />
      <div className="wrap">
        <Reveal onReveal={onReveal}>
          <Eyebrow light>{hero.eyebrow}</Eyebrow>
          <h1>
            {hero.titleLead}
            <span className="hl">{hero.titleHighlight}</span>
          </h1>
          <p className="sub">{hero.sub}</p>
          <div className="cta-row">
            <a className="btn light" href="#how">
              {hero.cta}
            </a>
            <small>{hero.note}</small>
          </div>
        </Reveal>
        <Reveal className="stage">
          <div className="mascot" data-pose={pose}>
            <Image className="p1" src={images.working} alt={hero.mascotWorking} sizes="(max-width: 760px) 280px, 560px" priority />
            <Image className="p2" src={images.success} alt={hero.mascotSuccess} sizes="(max-width: 760px) 280px, 560px" />
          </div>
        </Reveal>
      </div>
    </header>
  );
}
