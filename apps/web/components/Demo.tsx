"use client";

import { useCallback, useState } from "react";
import { copy, demoScript } from "@/content/copy";
import { useStartOnReveal } from "@/hooks/useStartOnReveal";
import { useThread } from "@/hooks/useThread";
import { CallPhone } from "./CallPhone";
import { Reveal } from "./Reveal";
import { AppearanceMock } from "./Scene";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const IDLE = { go: false, press: false, dark: false };

/** A Mac and a phone side by side: the text goes out, the Mac changes, the result comes back. */
export function Demo() {
  const { demo } = copy;
  const thread = useThread();
  const [mac, setMac] = useState(IDLE);
  // Changing this key remounts the dotted link, which restarts its animation.
  const [pulse, setPulse] = useState(0);
  const { play } = thread;

  const act = useCallback(async (_action: string, alive: () => boolean, instant: boolean) => {
    if (instant) {
      setMac({ go: true, press: false, dark: true });
      return;
    }
    setPulse((count) => count + 1);
    setMac((state) => ({ ...state, go: true }));
    await sleep(1250);
    if (!alive()) return;
    setMac((state) => ({ ...state, press: true }));
    await sleep(220);
    setMac((state) => ({ ...state, press: false, dark: true }));
    await sleep(1000);
  }, []);

  const run = useCallback(() => {
    setMac(IDLE);
    setPulse(0);
    void play(demoScript, { onAction: act });
  }, [act, play]);

  const onReveal = useStartOnReveal(run, 700);
  const macClasses = ["appr", mac.go ? "go" : "", mac.press ? "press" : "", mac.dark ? "dark" : ""].filter(Boolean).join(" ");

  return (
    <section id="demo" className="demo">
      <div className="wrap">
        <Reveal className="demobox" onReveal={onReveal}>
          <div className="center">
            <span className="eyebrow">{demo.eyebrow}</span>
            <h2>{demo.title}</h2>
            <p className="lead">{demo.lead}</p>
          </div>
          <div className="devices">
            <div className="laptop">
              <div className="lscreen">
                <div className={macClasses}>
                  <AppearanceMock cursor />
                </div>
              </div>
              <div className="lbase" />
            </div>
            <div key={pulse} className={`link${pulse > 0 ? " run" : ""}`} aria-hidden="true">
              <i />
            </div>
            <div className="demophone">
              <div>
                <CallPhone call={{ items: thread.items, typing: thread.typing, scene: "appearance" }} dark={mac.dark} />
              </div>
            </div>
          </div>
          <div className="demobar">
            <button className="chipbtn" onClick={run}>
              {demo.replay}
            </button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
