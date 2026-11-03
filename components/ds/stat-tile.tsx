// components/ds/stat-tile.tsx - One number with a label (purse left, players
// sold...). The number is in the display face with tabular figures.
import { cn } from "@/lib/utils"

const tones = {
  default: "text-ink",
  signal: "text-signal",
  sold: "text-sold",
  unsold: "text-unsold",
  timer: "text-timer",
}

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
  className,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  tone?: keyof typeof tones
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-card border border-line bg-surface p-4", className)}>
      <span className="text-xs font-semibold tracking-wider text-ink-muted uppercase">{label}</span>
      <span className={cn("font-head text-4xl leading-none font-bold tabular", tones[tone])}>{value}</span>
      {hint && <span className="text-sm text-ink-muted">{hint}</span>}
    </div>
  )
}
