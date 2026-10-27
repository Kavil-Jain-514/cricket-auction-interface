// components/ds/player-card.tsx - A player in three densities:
//   hero    - the player on the block (projector, owner phone)
//   compact - a tile in a grid (sold / unsold lists)
//   row     - one line in a squad list
// Status colours: SOLD = sold, UNSOLD = unsold. Never the accent.
import { CloudImage } from "@/components/ds/cloud-image"
import { TeamChip } from "@/components/ds/team-chip"
import { cn, formatCurrency, getPlayerInitials } from "@/lib/utils"

export interface PlayerCardData {
  name: string
  photoUrl?: string
  roles: string[]
  playerNumber?: number
  category?: string
  basePrice: number
  status?: "upcoming" | "live" | "sold" | "unsold"
  soldPrice?: number
  team?: { name: string; color: string; logoUrl?: string }
}

function Photo({ player, size, priority }: { player: PlayerCardData; size: number; priority?: boolean }) {
  if (!player.photoUrl) {
    return (
      <span
        aria-hidden
        className="flex size-full items-center justify-center bg-raised font-head text-[2.5em] font-bold text-ink-muted"
      >
        {getPlayerInitials(player.name)}
      </span>
    )
  }
  return (
    <CloudImage
      src={player.photoUrl}
      alt=""
      width={size}
      height={size}
      priority={priority}
      // Face-safe crop: faces sit in the upper third of most player photos.
      className="size-full object-cover object-[50%_25%]"
    />
  )
}

function StatusBadge({ status }: { status: PlayerCardData["status"] }) {
  if (status !== "sold" && status !== "unsold") return null
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs font-bold tracking-wider uppercase",
        status === "sold" ? "bg-sold text-canvas" : "bg-unsold text-canvas"
      )}
    >
      {status}
    </span>
  )
}

function RoleChips({ player }: { player: PlayerCardData }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Roles">
      {player.category && (
        <li className="rounded-full border border-signal/60 px-2.5 py-0.5 text-xs font-semibold text-signal">
          {player.category}
        </li>
      )}
      {player.roles.map((r) => (
        <li key={r} className="rounded-full bg-raised px-2.5 py-0.5 text-xs font-medium text-ink">
          {r}
        </li>
      ))}
    </ul>
  )
}

export function PlayerCard({
  player,
  variant = "compact",
  priority,
  className,
}: {
  player: PlayerCardData
  variant?: "hero" | "compact" | "row"
  /** Only for the LCP image on the page. */
  priority?: boolean
  className?: string
}) {
  const price = player.status === "sold" && player.soldPrice !== undefined ? player.soldPrice : player.basePrice
  const priceLabel = player.status === "sold" ? "Sold for" : "Base price"

  if (variant === "row") {
    return (
      <div className={cn("flex min-h-14 items-center gap-3 rounded-control px-2 py-1.5 hover:bg-raised", className)}>
        <span className="size-11 shrink-0 overflow-hidden rounded-full">
          <Photo player={player} size={44} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-ink">{player.name}</span>
          <span className="block truncate text-sm text-ink-muted">{player.roles.join(" · ")}</span>
        </span>
        <span className="font-head text-xl font-bold text-ink tabular">{formatCurrency(price)}</span>
      </div>
    )
  }

  if (variant === "compact") {
    return (
      <article
        className={cn("overflow-hidden rounded-card border border-line bg-surface shadow-raised", className)}
      >
        <div className="relative aspect-4/5 text-[1rem]">
          <Photo player={player} size={320} priority={priority} />
          <div className="absolute top-2 right-2">
            <StatusBadge status={player.status} />
          </div>
        </div>
        <div className="flex flex-col gap-2 p-3">
          <h3 className="truncate font-head text-xl font-bold uppercase tracking-wide text-ink">{player.name}</h3>
          <RoleChips player={player} />
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-ink-muted">{priceLabel}</span>
            <span className="font-head text-2xl font-bold text-ink tabular">{formatCurrency(price)}</span>
          </div>
          {player.team && <TeamChip {...player.team} variant="outline" />}
        </div>
      </article>
    )
  }

  // hero
  return (
    <article
      className={cn(
        "grid overflow-hidden rounded-panel border border-line bg-surface shadow-floating sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]",
        className
      )}
    >
      <div className="relative aspect-square text-[2rem] sm:aspect-auto sm:min-h-80">
        <Photo player={player} size={640} priority={priority} />
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-surface to-transparent sm:hidden" />
      </div>
      <div className="flex flex-col justify-center gap-4 p-6">
        <div className="flex items-center gap-3 text-sm text-ink-muted">
          {player.playerNumber !== undefined && (
            <span className="font-head text-lg font-bold text-ink tabular">#{player.playerNumber}</span>
          )}
          <StatusBadge status={player.status} />
        </div>
        <h2 className="font-head text-5xl leading-none font-bold uppercase tracking-wide text-ink sm:text-6xl">
          {player.name}
        </h2>
        <RoleChips player={player} />
        <div>
          <div className="text-sm text-ink-muted">{priceLabel}</div>
          <div className="font-head text-4xl font-bold text-ink tabular">{formatCurrency(price)}</div>
        </div>
        {player.team && <TeamChip {...player.team} />}
      </div>
    </article>
  )
}
