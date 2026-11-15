import { ICONS, type IconName } from "@/lib/icons";

/** A flat line icon. It takes its color from the text around it. Decorative, so hidden from screen readers. */
export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg className={`icon ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}
