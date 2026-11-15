import { copy } from "@/content/copy";
import { Eyebrow } from "./Eyebrow";
import { Icon } from "./Icon";
import { Picture } from "./Picture";
import { Reveal } from "./Reveal";

export function HowItWorks() {
  const { how } = copy;
  return (
    <section id="how" className="slide how">
      <div className="wrap">
        <Reveal>
          <Eyebrow>{how.eyebrow}</Eyebrow>
          <h2>{how.title}</h2>
          <p className="lead">{how.lead}</p>
        </Reveal>
        <div className="steps">
          {how.steps.map((step, index) => (
            <Reveal key={step.title} pop className="step" delay={`${(index * 0.12).toFixed(2)}s`}>
              <Picture label={step.picture} ratio="4 / 3" />
              <div className="stephead">
                <span className="num">{String(index + 1).padStart(2, "0")}</span>
                <Icon name={step.icon} />
              </div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
