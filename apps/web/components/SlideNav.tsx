"use client";

import { copy } from "@/content/copy";
import { useActiveSlide } from "@/hooks/useActiveSlide";

const IDS = copy.slides.map((slide) => slide.id);

/** Dots down the side, one per slide. The current one is filled. */
export function SlideNav() {
  const active = useActiveSlide(IDS);
  return (
    <div className="slidenav" role="navigation" aria-label={copy.a11y.slides}>
      {copy.slides.map((slide) => (
        <a key={slide.id} href={`#${slide.id}`} aria-label={slide.label} aria-current={active === slide.id ? "true" : undefined} className={active === slide.id ? "on" : undefined} />
      ))}
    </div>
  );
}
