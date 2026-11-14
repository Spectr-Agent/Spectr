import { sourceLinks } from "@/lib/sources";

/** The name of a research source, as a link when there is one. */
export function Source({ name, link }: { name: string; link: string }) {
  const href = sourceLinks[link];
  return <cite>{href ? <a href={href} target="_blank" rel="noopener">{name}</a> : name}</cite>;
}
