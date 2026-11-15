"use client";

import { useCallback, useEffect, useRef } from "react";
import { copy } from "@/content/copy";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { Eyebrow } from "./Eyebrow";
import { Reveal } from "./Reveal";

/** A Mac and a phone side by side, each playing a real screen recording of the same booking. */
export function Demo() {
  const { demo } = copy;
  const reduced = useReducedMotion();
  const devices = useRef<HTMLDivElement>(null);
  const mac = useRef<HTMLVideoElement>(null);
  const phone = useRef<HTMLVideoElement>(null);

  const restart = useCallback(() => {
    for (const video of [mac.current, phone.current]) {
      if (!video) continue;
      video.currentTime = 0;
      void video.play().catch(() => undefined);
    }
  }, []);

  // Both clips are the same length, so the phone ending restarts the pair together.
  useEffect(() => {
    const videos = [mac.current, phone.current];
    for (const video of videos) if (video) video.muted = true;
    const element = devices.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        for (const video of videos) {
          if (!video) continue;
          if (entry?.isIntersecting && !reduced) void video.play().catch(() => undefined);
          else video.pause();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [reduced]);

  return (
    <section id="demo" className="slide demo">
      <div className="wrap">
        <Reveal>
          <div className="center">
            <Eyebrow>{demo.eyebrow}</Eyebrow>
            <h2>{demo.title}</h2>
            <p className="lead">{demo.lead}</p>
          </div>
          <div className="devices" ref={devices}>
            <div className="laptop">
              <div className="lscreen">
                <video ref={mac} src="/demo/mac.mp4" poster="/demo/mac-poster.jpg" muted playsInline preload="metadata" controls={reduced} aria-label={demo.macVideo} />
              </div>
              <div className="lbase" />
            </div>
            <div className="link" aria-hidden="true" />
            <div className="demophone">
              <div>
                <div className="phone">
                  <div className="pscreen pvid">
                    <video ref={phone} src="/demo/phone.mp4" poster="/demo/phone-poster.jpg" muted playsInline preload="metadata" controls={reduced} onEnded={restart} aria-label={demo.phoneVideo} />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="demobar">
            <button className="chipbtn" onClick={restart}>
              {demo.replay}
            </button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
