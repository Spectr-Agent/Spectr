/** A black placeholder where a photo goes. The label says what picture belongs here. */
export function Picture({ label, ratio = "4 / 3", fill = false }: { label: string; ratio?: string; fill?: boolean }) {
  return (
    <div className={`pic${fill ? " fill" : ""}`} role="img" aria-label={label} style={fill ? undefined : { aspectRatio: ratio }}>
      <span>{label}</span>
    </div>
  );
}
