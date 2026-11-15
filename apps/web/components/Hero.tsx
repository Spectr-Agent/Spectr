"use client";

import { useCallback, useEffect } from "react";
import { copy, heroScript } from "@/content/copy";
import { useCall } from "@/hooks/useCall";
import { CallPhone } from "./CallPhone";
import { Eyebrow } from "./Eyebrow";
import { Picture } from "./Picture";
import { Reveal } from "./Reveal";

export function Hero() {
  const { hero } = copy;
  const call = useCall();
  const { play } = call;

  const run = useCallback(() => void play(heroScript), [play]);

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
