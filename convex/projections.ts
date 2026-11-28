// convex/projections.ts - Public-safe shapes for documents returned to viewers

/**
 * Strip private contact details (phoneNumber, and a couple partner's
 * phoneNumber) from a player before it leaves the server for a non-admin
 * viewer. Every other field passes through as-is. The partner keeps its
 * type: its phoneNumber is optional there (ruleValidators.partnerValidator).
 */
export function toPublicPlayer<T extends { phoneNumber?: string; partner?: { phoneNumber?: string } }>(
  player: T,
): Omit<T, "phoneNumber"> {
  const { phoneNumber: _stripped, partner, ...publicFields } = player;
  if (!partner) return publicFields as Omit<T, "phoneNumber">;
  const { phoneNumber: _partnerPhone, ...publicPartner } = partner;
  return { ...publicFields, partner: publicPartner } as Omit<T, "phoneNumber">;
}
