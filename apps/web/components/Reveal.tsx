"use client";

import type { CSSProperties, ElementType, HTMLAttributes, ReactNode } from "react";
import { useReveal } from "@/hooks/useReveal";

interface RevealProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  /** Use the squash and stretch bounce instead of the fade and rise. */
  pop?: boolean;
  /** Delay before the animation starts, such as "0.12s". */
  delay?: string;
  onReveal?: () => void;
  children?: ReactNode;
}

/** Fades or pops its content in once, the first time it scrolls into view. */
export function Reveal({ as: Tag = "div", pop = false, delay, onReveal, className = "", style, children, ...rest }: RevealProps) {
  const { ref, shown } = useReveal<HTMLElement>(onReveal);
  const classes = [pop ? "pop" : "reveal", shown ? "in" : "", className].filter(Boolean).join(" ");
  const styles = delay ? ({ ...style, "--d": delay } as CSSProperties) : style;
  return (
    <Tag ref={ref} className={classes} style={styles} {...rest}>
      {children}
    </Tag>
  );
}
