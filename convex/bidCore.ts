// convex/bidCore.ts
// The one place a bid is validated and written. auctions:placeBid (admin),
// raiseBid (owner, open mode) and acceptBidRequest (owner, confirm mode) all
// go through applyBid, so an owner raise is held to exactly the admin rules.
// getMyPaddle and getPendingBidRequests read the same limits through
// loadBidContext / minNextBidFor, so what the UI shows is what is enforced.
import { MutationCtx, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import {
  DEFAULT_BASE_PRICE,
  isSquadFull,
  maxAllowedBid,
  reserveBasePrice,
} from "./bidRules";

export type BidSource = "admin" | "owner";

// `reason?: undefined` on success keeps `res.reason` readable without narrowing,
// as it was when placeBid's return type was inferred.
export type BidResult =
  | { success: true; amount: number; teamId: Id<"teams">; reason?: undefined }
  | { success: false; reason: string; maxAllowedBid?: number };

/** Same-team spacing between bids (and between owner raise requests). */
export const BID_SPACING_MS = 500;

/** Newest live bid for a player (index read, no collect). */
export async function latestLiveBid(
  ctx: QueryCtx,
  playerId: Id<"players">,
): Promise<Doc<"liveBids"> | null> {
  return await ctx.db
    .query("liveBids")
    .withIndex("by_player", (q) => q.eq("playerId", playerId))
    .order("desc")
    .first();
}

/** Base price for a player, falling back to the tournament default. */
export function playerBasePriceFor(
  player: Doc<"players">,
  tournament: Doc<"tournaments">,
): number {
  return (
    player.basePrice ?? tournament.settings.basePrice ?? DEFAULT_BASE_PRICE
  );
}

/** Lowest bid that would be accepted next: base price first, then +increment. */
export function minNextBidFor(
  latestBid: Doc<"liveBids"> | null,
  playerBasePrice: number,
  tournament: Doc<"tournaments">,
): number {
  return latestBid
    ? latestBid.amount + tournament.settings.minBidIncrement
    : playerBasePrice;
}

/**
 * Everything a bid decision for `team` needs. `player` and the bid fields are
 * null when no player is up (the paddle still shows purse and squad).
 */
export async function loadBidContext(
  ctx: QueryCtx,
  room: Doc<"auctionRooms">,
  team: Doc<"teams">,
) {
  const [player, tournament, teamPlayers, latestBid] = await Promise.all([
    room.currentPlayerId ? ctx.db.get(room.currentPlayerId) : null,
    ctx.db.get(room.tournamentId),
    ctx.db
      .query("players")
      .withIndex("by_team", (q) => q.eq("teamId", team._id))
      .collect(),
    room.currentPlayerId ? latestLiveBid(ctx, room.currentPlayerId) : null,
  ]);
  if (!tournament) throw new Error("Tournament not found");

  const maxPlayersPerTeam = tournament.settings.maxPlayersPerTeam;
  const tournamentBasePrice =
    tournament.settings.basePrice ?? DEFAULT_BASE_PRICE;
  const playerBasePrice = player
    ? playerBasePriceFor(player, tournament)
    : null;

  // Squad-completion reserve — same rule getAuctionRoster displays (bidRules.ts).
  // minPendingBasePrice comes from the denormalized tournament.auctionCounts,
  // so no pending-player scan on this hot path.
  const allowedMax = maxAllowedBid({
    purseRemaining: team.purseRemaining,
    playersOnTeam: teamPlayers.length,
    maxPlayersPerTeam,
    reservePrice: reserveBasePrice({
      minPendingBasePrice: tournament.auctionCounts?.minPendingBasePrice,
      currentPlayerBasePrice: playerBasePrice ?? undefined,
      tournamentBasePrice,
    }),
  });

  return {
    player,
    tournament,
    teamPlayers,
    latestBid,
    playerBasePrice,
    allowedMax,
    minNextBid:
      playerBasePrice === null
        ? null
        : minNextBidFor(latestBid, playerBasePrice, tournament),
  };
}

/**
 * Validate a bid for `team` on the room's current player and, unless
 * `dryRun`, record it. An omitted `amount` means the minimum valid next bid.
 * Expected rule failures return `{ success: false, reason }`; only missing
 * documents throw.
 */
export async function applyBid(
  ctx: MutationCtx,
  args: {
    room: Doc<"auctionRooms">;
    team: Doc<"teams">;
    amount?: number;
    source: BidSource;
    userId: Id<"users">;
    dryRun?: boolean;
  },
): Promise<BidResult> {
  const { room, team } = args;

  // Also rejects NaN / Infinity, which compare false against every limit below.
  if (
    args.amount !== undefined &&
    !(Number.isFinite(args.amount) && args.amount > 0)
  ) {
    return { success: false, reason: "Bid amount must be positive" };
  }

  if (room.status !== "live") {
    return { success: false, reason: "Auction is not live" };
  }

  if (!room.currentPlayerId) {
    return { success: false, reason: "No player currently in auction" };
  }

  // NOTE: No server-side timer-expiry guard. This auction is auctioneer-paced —
  // a human calls each bid and finalizes manually — so a legitimately-called
  // bid that lands after `bidTimerEndsAt` (e.g. a long player introduction or a
  // mid-bidding lull) must still be accepted. `bidTimerEndsAt` is a UI countdown
  // only; it must never silently drop a real bid. (See AUDIT.md P0-1.)

  if (team.tournamentId !== room.tournamentId) {
    return {
      success: false,
      reason: "Team is not part of this auction's tournament",
    };
  }

  const bidCtx = await loadBidContext(ctx, room, team);
  if (!bidCtx.player) throw new Error("Player not found");
  const { tournament, teamPlayers, latestBid, allowedMax } = bidCtx;
  const playerBasePrice = bidCtx.playerBasePrice!;
  const amount = args.amount ?? bidCtx.minNextBid!;

  if (isSquadFull(teamPlayers.length, tournament.settings.maxPlayersPerTeam)) {
    return { success: false, reason: "Squad is full" };
  }

  if (team.purseRemaining < amount) {
    return { success: false, reason: "Insufficient purse balance" };
  }

  if (amount > allowedMax) {
    return {
      success: false,
      reason: `Cannot bid this amount. Insufficient purse to complete squad. Max allowed: ₹${(allowedMax / 100000).toFixed(2)}L`,
      maxAllowedBid: allowedMax,
    };
  }

  // Bid rate limiting: reject if same team bid < 500ms ago (prevents spam)
  if (
    latestBid &&
    latestBid.teamId === team._id &&
    Date.now() - latestBid.timestamp < BID_SPACING_MS
  ) {
    return { success: false, reason: "Please wait before bidding again" };
  }

  const currentBid = latestBid?.amount || playerBasePrice;
  const minBidIncrement = tournament.settings.minBidIncrement;

  if (!latestBid) {
    if (amount < playerBasePrice) {
      return {
        success: false,
        reason: "First bid must be at least base price",
      };
    }
  } else {
    if (amount < currentBid + minBidIncrement) {
      return {
        success: false,
        reason: "Minimum bid is " + (currentBid + minBidIncrement),
      };
    }
  }

  if (args.dryRun) return { success: true, amount, teamId: team._id };

  const now = Date.now();
  const bidTimerSeconds = tournament.settings.bidTimerSeconds || 30;

  // Insert bid AND reset timer on every bid.
  // Note: per-bid audit logging is intentionally omitted here — bidding is
  // a high-frequency hot path and logging every bid would cause write
  // amplification and rapid auditLogs growth. The full bid history is
  // already captured in the liveBids table (with source + userId) and
  // archived to bids on finalization, which is sufficient for auditing.
  await Promise.all([
    ctx.db.insert("liveBids", {
      auctionRoomId: room._id,
      playerId: room.currentPlayerId,
      teamId: team._id,
      amount,
      timestamp: now,
      source: args.source,
      userId: args.userId,
    }),
    // Reset timer on every bid
    ctx.db.patch(room._id, {
      bidTimerEndsAt: now + bidTimerSeconds * 1000,
      updatedAt: now,
    }),
  ]);

  return { success: true, amount, teamId: team._id };
}
