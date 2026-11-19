// convex/staffRoles.ts - The tournament staff roles, shared by the schema
// (tournamentStaff, staffInvites, the staff email) and staff.ts.
import { v } from "convex/values";

/**
 * "owner": everything. "auctioneer": runs the auction. "registrar"
 * (registration admin): reviews player registrations only. See TournamentRole
 * and the role lists in auth.ts.
 */
export const staffRoleValidator = v.union(v.literal("owner"), v.literal("auctioneer"), v.literal("registrar"));
