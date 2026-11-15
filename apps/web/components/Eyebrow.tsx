import Image from "next/image";
import type { ReactNode } from "react";
import { images } from "@/lib/images";

/** A small label with the flat star in front. */
export function Eyebrow({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return (
    <span className="eyebrow">
      <Image src={light ? images.starWhite : images.starBlack} alt="" width={18} height={18} />
      {children}
    </span>
  );
}
