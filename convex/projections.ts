// convex/projections.ts - Public-safe shapes for documents returned to viewers

/**
 * Strip private contact details (phoneNumber) from a player before it leaves
 * the server for a non-admin viewer. Every other field passes through as-is.
 */
export function toPublicPlayer<T extends { phoneNumber?: string }>(
  player: T,
): Omit<T, "phoneNumber"> {
  const { phoneNumber: _stripped, ...publicFields } = player;
  return publicFields;
}
