"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { copy, heroScript } from "@/content/copy";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useThread } from "@/hooks/useThread";
import { images } from "@/lib/images";
import { PhoneThread } from "./PhoneThread";
import { Reveal } from "./Reveal";

export function Hero() {
  const { hero } = copy;
  const thread = useThread();
  const reduced = useReducedMotion();
  const [pose, setPose] = useState<"working" | "success">("working");
  const { play } = thread;

  // The mascot works while Spectr replies, then swaps to the success pose when the result lands.
  const run = useCallback(() => {
    setPose(reduced ? "success" : "working");
    void play(heroScript, {
      typeUser: false,
      onShow: (step) => {
        if (step.pose) setPose(step.pose);
      },
    });
  }, [play, reduced]);

  useEffect(() => {
    const timer = setTimeout(run, 500);
    return () => clearTimeout(timer);
  }, [run]);

  return (
    <header className="hero">
      <div className="wrap">
        <Reveal>
          <span className="eyebrow">{hero.eyebrow}</span>
          <h1>
            {hero.titleLead}
            <span className="hl">{hero.titleHighlight}</span>
          </h1>
          <p className="sub">{hero.sub}</p>
          <div className="cta-row">
            <a className="btn" href="#waitlist">
              {hero.cta}
            </a>
            <small>{hero.note}</small>
          </div>
        </Reveal>
        <Reveal className="stage">
          <div className="blob" />
          <div className="mascot" data-pose={pose}>
            <Image className="p1" src={images.working} alt={hero.mascotWorking} sizes="300px" priority />
            <Image className="p2" src={images.success} alt={hero.mascotSuccess} sizes="300px" />
          </div>
          <div className="phonewrap">
            <div>
              <PhoneThread thread={thread} />
            </div>
          </div>
          <button className="chipbtn replay" onClick={run}>
            {hero.replay}
          </button>
        </Reveal>
      </div>
    </header>
  );
}
