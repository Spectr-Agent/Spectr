import Image from "next/image";
import { copy } from "@/content/copy";
import { images } from "@/lib/images";
import { Reveal } from "./Reveal";

export function HowItWorks() {
  const { how } = copy;
  return (
    <section id="how">
      <div className="wrap center">
        <Reveal>
          <span className="eyebrow">{how.eyebrow}</span>
          <h2>{how.title}</h2>
          <p className="lead">{how.lead}</p>
        </Reveal>
        <div className="steps">
          {how.steps.map((step, index) => (
            <Reveal key={step.title} pop className="step" delay={`${(index * 0.12).toFixed(2)}s`}>
              <span className="num">{index + 1}</span>
              <Image src={images[step.image]} alt={step.alt} sizes="(max-width: 760px) 112px, 170px" />
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
