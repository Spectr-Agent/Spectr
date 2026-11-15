"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import { copy } from "@/content/copy";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useStartOnReveal } from "@/hooks/useStartOnReveal";
import { images } from "@/lib/images";
import { Footer } from "./Footer";
import { Picture } from "./Picture";
import { Reveal } from "./Reveal";

/** The last slide: the star says hi, text is mentioned as a side option, and the footer sits at the bottom. */
export function Closing() {
  const { closing } = copy;
  const reduced = useReducedMotion();
  const [waving, setWaving] = useState(false);
  const onReveal = useStartOnReveal(useCallback(() => setWaving(!reduced), [reduced]), 900);
  return (
    <section id="closing" className="slide closing">
      <Picture fill label={closing.picture} />
      <div className="wrap center">
        <Reveal onReveal={onReveal}>
          <div className={`m${waving ? " waving" : ""}`}>
            <Image src={images.starWhite} alt="" sizes="(max-width: 760px) 120px, 180px" />
          </div>
          <h2>{closing.title}</h2>
          <p className="lead">{closing.lead}</p>
        </Reveal>
        <Reveal className="textopt">
          <p>{closing.textLine}</p>
          <div className="bubbles">
            <div className="msg me">
              <div className="bub">{closing.me}</div>
            </div>
            <div className="msg bot">
              <div className="bub">{closing.bot}</div>
            </div>
          </div>
        </Reveal>
      </div>
      <Footer />
    </section>
  );
}
