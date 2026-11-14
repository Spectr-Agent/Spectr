"use client";

import Image from "next/image";
import { useCallback, useState, type FormEvent } from "react";
import { copy } from "@/content/copy";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { useStartOnReveal } from "@/hooks/useStartOnReveal";
import { images } from "@/lib/images";
import { Reveal } from "./Reveal";

type Status = "idle" | "sending" | "done" | "invalid" | "tooMany" | "failed";

export function FinalCta() {
  const { cta } = copy;
  const reduced = useReducedMotion();
  const [waving, setWaving] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const onReveal = useStartOnReveal(useCallback(() => setWaving(!reduced), [reduced]), 900);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus("sending");
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: String(data.get("email") ?? ""), company: String(data.get("company") ?? "") }),
      });
      if (response.ok) {
        setStatus("done");
        form.reset();
      } else if (response.status === 429) {
        setStatus("tooMany");
      } else if (response.status === 400) {
        setStatus("invalid");
      } else {
        setStatus("failed");
      }
    } catch {
      setStatus("failed");
    }
  }

  const message = { idle: "", sending: "", done: cta.success, invalid: cta.invalid, tooMany: cta.tooMany, failed: cta.failed }[status];

  return (
    <section id="waitlist" className="final">
      <div className="wrap">
        <Reveal className="ctabox" onReveal={onReveal}>
          <div className={`m${waving ? " waving" : ""}`}>
            <Image src={images.welcome} alt={cta.mascotAlt} sizes="(max-width: 760px) 230px, 300px" />
          </div>
          <h2>{cta.title}</h2>
          <p className="lead">{cta.lead}</p>
          <form className="form" onSubmit={submit}>
            <input type="email" name="email" required maxLength={254} autoComplete="email" placeholder={cta.emailPlaceholder} aria-label={copy.a11y.email} />
            {/* Honeypot: people never see this. Bots tend to fill it in. */}
            <input className="hp" type="text" name="company" tabIndex={-1} autoComplete="off" aria-hidden="true" />
            <button className="btn" type="submit" disabled={status === "sending"}>
              {status === "sending" ? cta.sending : cta.button}
            </button>
          </form>
          <div className="formmsg" aria-live="polite">
            {message}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
