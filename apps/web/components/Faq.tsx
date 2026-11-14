"use client";

import { useState } from "react";
import { copy } from "@/content/copy";
import { Reveal } from "./Reveal";

export function Faq() {
  const { faq } = copy;
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq">
      <div className="wrap">
        <Reveal className="center">
          <span className="eyebrow">{faq.eyebrow}</span>
          <h2>{faq.title}</h2>
        </Reveal>
        <Reveal className="faqlist">
          {faq.items.map((item, index) => {
            const isOpen = open === index;
            return (
              <div key={item.q} className={`qa${isOpen ? " open" : ""}`}>
                <button aria-expanded={isOpen} aria-controls={`faq-answer-${index}`} onClick={() => setOpen(isOpen ? null : index)}>
                  <span>{item.q}</span>
                  <i className="pm" />
                </button>
                <div className="ans" id={`faq-answer-${index}`} inert={!isOpen}>
                  <div>
                    <p>
                      {item.a}
                      {/* OPEN ITEM 2: placeholder tag stays until pricing and the launch date are decided. */}
                      {"placeholderTag" in item ? <span className="tag">{item.placeholderTag}</span> : null}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </Reveal>
      </div>
    </section>
  );
}
