import { copy } from "@/content/copy";
import { Eyebrow } from "./Eyebrow";
import { Reveal } from "./Reveal";
import { Source } from "./Source";

/** The three big numbers. A dark slide so they stand out. */
export function Research() {
  const { research } = copy;
  return (
    <section id="research" className="slide research">
      <div className="wrap">
        <Reveal>
          <Eyebrow light>{research.eyebrow}</Eyebrow>
          <h2>{research.title}</h2>
        </Reveal>
        <div className="bigstats">
          {research.big.map((stat, index) => (
            <Reveal key={stat.figure} pop className="bigstat" delay={`${(index * 0.14).toFixed(2)}s`}>
              <b>{stat.figure}</b>
              <p>{stat.text}</p>
              <Source name={stat.source} link={stat.link} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
