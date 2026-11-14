import { copy } from "@/content/copy";
import { Reveal } from "./Reveal";

/** Text is a side option. A small band, not a section of its own. */
export function TextToo() {
  const { textToo } = copy;
  return (
    <section id="text" className="texttoo">
      <div className="wrap">
        <div className="sidebox">
          <Reveal>
            <span className="eyebrow">{textToo.eyebrow}</span>
            <h2>{textToo.title}</h2>
            <p className="lead">{textToo.lead}</p>
          </Reveal>
          <Reveal className="sidebubbles">
            <div className="msg me tail">
              <div className="bub">{textToo.me}</div>
            </div>
            <div className="msg bot tail">
              <div className="bub">{textToo.bot}</div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
