import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { copy } from "@/content/copy";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const nunito = localFont({
  src: [
    { path: "./fonts/nunito-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/nunito-700.woff2", weight: "700", style: "normal" },
    { path: "./fonts/nunito-800.woff2", weight: "800", style: "normal" },
    { path: "./fonts/nunito-900.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-nunito",
  display: "swap",
});

export const metadata: Metadata = {
  title: copy.meta.title,
  description: copy.meta.description,
  metadataBase: SITE_URL ? new URL(SITE_URL) : undefined,
  openGraph: { title: copy.meta.title, description: copy.meta.description, type: "website" },
};

export const viewport: Viewport = { themeColor: "#FBF7F0" };

// Runs before the page paints. The "js" class turns on the reveal animations, and
// "rm" turns them off for people who asked their system for less motion
// (or with ?rm=1 in the address). The reduced motion hook keeps it in step afterwards.
const BOOT = `(function(){var d=document.documentElement;d.classList.add("js");var q=new URLSearchParams(location.search).get("rm");if(q==="1"||(q!=="0"&&matchMedia("(prefers-reduced-motion: reduce)").matches))d.classList.add("rm")})()`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={nunito.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
