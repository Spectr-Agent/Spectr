"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { copy, heroScript } from "@/content/copy";
import { useCall } from "@/hooks/useCall";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { images } from "@/lib/images";
import { CallPhone } from "./CallPhone";
import { Eyebrow } from "./Eyebrow";
import { Picture } from "./Picture";
import { Reveal } from "./Reveal";

export function Hero() {
  const { hero } = copy;
  const call = useCall();
  const reduced = useReducedMotion();
  const [pose, setPose] = useState<"working" | "success">("working");
  const { play } = call;

  // The mascot works while Spectr replies, then swaps to the success pose when the result lands.
  const run = useCallback(() => {
    setPose(reduced ? "success" : "working");
    void play(heroScript, {
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
    <header className="slide hero dark" id="top">
      <Picture fill label={hero.picture} />
      <div className="wrap">
        <Reveal>
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
            <Image className="p1" src={images.working} alt={hero.mascotWorking} sizes="300px" priority />
            <Image className="p2" src={images.success} alt={hero.mascotSuccess} sizes="300px" />
          </div>
          <div className="phonewrap">
            <div>
              <CallPhone call={call} />
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
