// convex/presentation.ts
// Which players startNextPlayer may draw from next in the main round when the
// tournament presents by category ("sets", IPL-style: Marquee first). Pure, so
// the ordering rule is unit-testable apart from the mutation.
import { categoryFor, type PlayerCategory } from "./bidRules";

/** Set id for players with no (or an unknown) category: always last. */
export const UNCATEGORISED_SET = "__uncategorised__";

export interface PresentationSet<P> {
  setId: string;
  /** Undefined for the uncategorised set. */
  category: PlayerCategory | undefined;
  players: P[];
}

/**
 * The lowest-order category that still has pending players, with those
 * players (the caller picks one at random). Uncategorised players form a
 * final set. Null when nobody is pending.
 */
export function nextPresentationSet<P extends { categoryId?: string }>(
  pending: P[],
  categories: PlayerCategory[] | undefined,
): PresentationSet<P> | null {
  const ordered = [...(categories ?? [])].sort((a, b) => a.order - b.order);
  for (const category of ordered) {
    const players = pending.filter((p) => p.categoryId === category.id);
    if (players.length > 0) return { setId: category.id, category, players };
  }
  const rest = pending.filter((p) => !categoryFor(p.categoryId, categories));
  return rest.length > 0
    ? { setId: UNCATEGORISED_SET, category: undefined, players: rest }
    : null;
}
