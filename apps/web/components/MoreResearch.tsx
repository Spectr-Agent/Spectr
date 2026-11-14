import { copy } from "@/content/copy";
import { Reveal } from "./Reveal";
import { Source } from "./Source";

/** The rest of the numbers, each with its source. */
export function MoreResearch() {
  const { more } = copy;
  return (
    <section id="more" className="slide more">
      <div className="wrap">
        <Reveal>
          <span className="eyebrow">{more.eyebrow}</span>
          <h2>{more.title}</h2>
        </Reveal>
        <Reveal as="ul" className="facts">
          {more.facts.map((fact) => (
            <li key={fact.text}>
              <p>{fact.text}</p>
              <Source name={fact.source} link={fact.link} />
            </li>
          ))}
        </Reveal>
      </div>
    </section>
  );
}
