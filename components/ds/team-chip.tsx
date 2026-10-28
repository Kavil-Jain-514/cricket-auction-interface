// components/ds/team-chip.tsx - A team, wearing its own colour. Team colours
// are organiser-picked, so the text colour is chosen for contrast (readableOn).
import { CloudImage } from "@/components/ds/cloud-image"
import { readableOn } from "@/lib/design/contrast"
import { cn, getPlayerInitials } from "@/lib/utils"

/** Readable text on the team colour; white if the stored colour isn't hex. */
function textOn(color: string): string {
  try {
    return readableOn(color)
  } catch {
    return "#ffffff"
  }
}

export function TeamChip({
  name,
  color,
  logoUrl,
  variant = "solid",
  leading = false,
  className,
}: {
  name: string
  /** Hex team colour. */
  color: string
  logoUrl?: string
  /** solid: filled with the team colour. outline: a colour bar on a surface. */
  variant?: "solid" | "outline"
  /** The team currently leading the bidding: adds the accent glow. */
  leading?: boolean
  className?: string
}) {
  const solid = variant === "solid"
  return (
    <span
      className={cn(
        "inline-flex min-h-11 max-w-full items-center gap-2 rounded-full py-1 pr-4 pl-1 text-sm font-semibold",
        !solid && "border border-line bg-surface text-ink",
        leading && "shadow-glow",
        className
      )}
      style={solid ? { backgroundColor: color, color: textOn(color) } : { borderLeft: `4px solid ${color}` }}
    >
      <span
        className="relative inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-canvas/20 text-xs font-bold"
        aria-hidden
      >
        {logoUrl ? (
          <CloudImage src={logoUrl} alt="" width={36} height={36} className="size-9 object-cover" />
        ) : (
          getPlayerInitials(name)
        )}
      </span>
      <span className="truncate">{name}</span>
    </span>
  )
}
