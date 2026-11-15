import Image from "next/image";
import { copy } from "@/content/copy";
import { images } from "@/lib/images";
import { Eyebrow } from "./Eyebrow";
import { Icon } from "./Icon";
import { Reveal } from "./Reveal";

export function Safety() {
  const { safety } = copy;
  return (
    <section id="safety" className="slide safety">
      <div className="wrap">
        <Reveal>
          <Eyebrow>{safety.eyebrow}</Eyebrow>
          <h2>{safety.title}</h2>
          <p className="lead">{safety.lead}</p>
        </Reveal>
        <div className="tiles">
          {safety.tiles.map((tile, index) => (
            <Reveal key={tile.title} pop className="tile" delay={`${(index * 0.12).toFixed(2)}s`}>
              {tile.image ? (
                <Image className={`mascotimg${tile.zoom ? " zoom" : ""}`} src={images[tile.image]} alt={tile.alt ?? ""} sizes="(max-width: 760px) 140px, 220px" />
              ) : (
                <Icon name={tile.icon} className="big" />
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
