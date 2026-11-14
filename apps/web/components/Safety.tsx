import Image from "next/image";
import { Fragment } from "react";
import { copy } from "@/content/copy";
import { images } from "@/lib/images";
import { Reveal } from "./Reveal";

export function Safety() {
  const { safety } = copy;
  return (
    <section id="safety">
      <div className="wrap center">
        <Reveal>
          <span className="eyebrow">{safety.eyebrow}</span>
          <h2>{safety.title}</h2>
          <p className="lead">{safety.lead}</p>
        </Reveal>
        <div className="tiles">
          {safety.tiles.map((tile, index) => (
            <Reveal key={tile.title} pop className="tile" delay={`${(index * 0.12).toFixed(2)}s`}>
              {"image" in tile ? (
                <Image className={tile.zoom ? "zoom" : undefined} src={images[tile.image]} alt={tile.alt} sizes="(max-width: 760px) 112px, 170px" />
              ) : (
                // OPEN ITEM 1: gray placeholder until the password mascot pose exists.
                <div className="ph-box" role="img" aria-label={tile.placeholder.label}>
                  {tile.placeholder.lines.map((line, lineIndex) => (
                    <Fragment key={line}>
                      {lineIndex > 0 ? <br /> : null}
                      {line}
                    </Fragment>
                  ))}
                </div>
              )}
              <h3>{tile.title}</h3>
              <p>{tile.text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
