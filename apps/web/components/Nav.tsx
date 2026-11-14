"use client";

import Image from "next/image";
import { useState } from "react";
import { copy } from "@/content/copy";
import { images } from "@/lib/images";

export function Nav() {
  const [open, setOpen] = useState(false);
  const { nav, a11y } = copy;
  return (
    <nav>
      <div className="wrap">
        <a className="logo" href="#top" aria-label={a11y.home}>
          <Image src={images.logo} alt={a11y.logoAlt} sizes="(max-width: 760px) 122px, 162px" priority />
        </a>
        <ul>
          {nav.links.map((link) => (
            <li key={link.href}>
              <a href={link.href}>{link.label}</a>
            </li>
          ))}
        </ul>
        <div className="navright">
          <a className="btn sm" href="#waitlist">
            {nav.cta}
          </a>
          <button className={`burger${open ? " open" : ""}`} aria-label={a11y.menu} aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((value) => !value)}>
            <i />
            <i />
            <i />
          </button>
        </div>
      </div>
      <div className={`mmenu${open ? " open" : ""}`} id="mobile-menu">
        {nav.links.map((link) => (
          <a key={link.href} href={link.href} onClick={() => setOpen(false)}>
            {link.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
