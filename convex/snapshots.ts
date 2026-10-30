// convex/snapshots.ts - Automatic tournament snapshots (AUDIT 2026-10 P0-3).
// takeSnapshot copies every auction-state table for a tournament before a
// destructive action (restart, delete) and before the auction starts, so a
// mis-tap is recoverable. Rows are stored in chunks (snapshotChunks) to stay
// well under Convex's 1 MiB document limit for large rosters.
import { v } from "convex/values";
import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { logAdminAction, OWNER_ONLY, RUN_AUCTION, requireTournamentRole } from "./auth";
import { syncTournamentAuctionCounts } from "./auctionCounts";
import { goLive } from "./auctionLifecycle";
import { confirmsTournamentName } from "./validation";

/** Rows per chunk: ~200 player docs is far below 1 MiB. */
const CHUNK_ROWS = 200;

/** The tables a snapshot holds, in restore order. */
export const SNAPSHOT_TABLES = [
  "tournament",
  "teams",
  "players",
  "auctionRooms",
  "liveBids",
  "bids",
  "auctionEvents",
  "groupDraws",
] as const;
export type SnapshotTable = (typeof SNAPSHOT_TABLES)[number];

/**
 * Copy the tournament's auction state. Callers check access first and pass
 * the acting user; returns the snapshot id for the audit row.
 */
export async function takeSnapshot(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  reason: string,
  userId: Id<"users"> | undefined,
): Promise<Id<"tournamentSnapshots">> {
  const tournament = await ctx.db.get(tournamentId);
  if (!tournament) throw new Error("Tournament not found");

  const [teams, players, rooms, groupDraws] = await Promise.all([
    ctx.db.query("teams").withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId)).collect(),
    ctx.db.query("players").withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId)).collect(),
    ctx.db.query("auctionRooms").withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId)).collect(),
    ctx.db.query("groupDraws").withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId)).collect(),
  ]);
  const perRoom = await Promise.all(
    rooms.map((room) =>
      Promise.all([
        ctx.db.query("liveBids").withIndex("by_room", (q) => q.eq("auctionRoomId", room._id)).collect(),
        ctx.db.query("bids").withIndex("by_auction_room", (q) => q.eq("auctionRoomId", room._id)).collect(),
        ctx.db.query("auctionEvents").withIndex("by_auction_room", (q) => q.eq("auctionRoomId", room._id)).collect(),
      ]),
    ),
  );
  const tables: Record<SnapshotTable, unknown[]> = {
    tournament: [tournament],
    teams,
    players,
    auctionRooms: rooms,
    liveBids: perRoom.flatMap(([live]) => live),
    bids: perRoom.flatMap(([, bids]) => bids),
    auctionEvents: perRoom.flatMap(([, , events]) => events),
    groupDraws,
  };

  const snapshotId = await ctx.db.insert("tournamentSnapshots", {
    tournamentId,
    tournamentName: tournament.name,
    reason,
    createdBy: userId,
    counts: {
      players: players.length,
      teams: teams.length,
      bids: tables.bids.length,
      events: tables.auctionEvents.length,
    },
    createdAt: Date.now(),
  });
  for (const table of SNAPSHOT_TABLES) {
    const rows = tables[table];
    for (let i = 0; i * CHUNK_ROWS < rows.length; i++) {
      await ctx.db.insert("snapshotChunks", {
        snapshotId,
        table,
        index: i,
        rows: rows.slice(i * CHUNK_ROWS, (i + 1) * CHUNK_ROWS),
      });
    }
  }
  return snapshotId;
}

/** A tournament's snapshots, newest first (no row data). Staff only. */
export const listForTournament = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await requireTournamentRole(ctx, args.tournamentId, RUN_AUCTION);
    return await ctx.db
      .query("tournamentSnapshots")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", args.tournamentId))
      .order("desc")
      .take(50);
  },
});

/** Every row of one snapshot, by table. Staff of that tournament only. */
export const getSnapshotData = query({
  args: { snapshotId: v.id("tournamentSnapshots") },
  handler: async (ctx, args) => {
    const snapshot = await ctx.db.get(args.snapshotId);
    if (!snapshot) throw new Error("Snapshot not found");
    await requireTournamentRole(ctx, snapshot.tournamentId, RUN_AUCTION);
    return await readSnapshotRows(ctx, args.snapshotId);
  },
});

/** A stored row: the original document. */
export type SnapshotRow = { _id: string } & Record<string, unknown>;

/** All chunks of a snapshot reassembled per table. */
export async function readSnapshotRows(
  ctx: QueryCtx,
  snapshotId: Id<"tournamentSnapshots">,
): Promise<Record<SnapshotTable, SnapshotRow[]>> {
  const chunks = await ctx.db
    .query("snapshotChunks")
    .withIndex("by_snapshot", (q) => q.eq("snapshotId", snapshotId))
    .collect();
  const out = Object.fromEntries(
    SNAPSHOT_TABLES.map((t) => [t, [] as SnapshotRow[]]),
  ) as Record<SnapshotTable, SnapshotRow[]>;
  for (const chunk of chunks.sort((a, b) => a.index - b.index)) {
    out[chunk.table as SnapshotTable]?.push(...(chunk.rows as SnapshotRow[]));
  }
  return out;
}

// ── Restore ──────────────────────────────────────────────────────────────────

/** A stored row without its system fields, ready to insert again. */
function withoutSystemFields(row: SnapshotRow) {
  const { _id: _ignoredId, _creationTime: _ignoredTime, ...rest } = row;
  return rest;
}

/**
 * Put a tournament's auction state back to a snapshot. Teams and players are
 * patched in place (their ids never change); bids, events and live bids are
 * replaced by the snapshot's. A player sold after the snapshot goes back to
 * pending so the restored purses still add up. Rooms come back in
 * `roomStatus(snapshotStatus)`. Callers check access and audit.
 */
async function applySnapshot(
  ctx: MutationCtx,
  snapshot: Doc<"tournamentSnapshots">,
  roomStatus: (status: Doc<"auctionRooms">["status"]) => Doc<"auctionRooms">["status"],
) {
  const rows = await readSnapshotRows(ctx, snapshot._id);
  const tournamentId = snapshot.tournamentId;
  const now = Date.now();
  const missing = { teams: 0, rooms: 0 };

  const snapTournament = rows.tournament[0] as unknown as Doc<"tournaments"> | undefined;
  if (snapTournament) {
    await ctx.db.patch(tournamentId, { status: snapTournament.status, updatedAt: now });
  }

  for (const row of rows.teams as unknown as Doc<"teams">[]) {
    if (!(await ctx.db.get(row._id))) {
      missing.teams++;
      continue;
    }
    await ctx.db.patch(row._id, {
      purseRemaining: row.purseRemaining,
      purseSpent: row.purseSpent,
      purseAdjustment: row.purseAdjustment,
      updatedAt: now,
    });
  }

  const snapPlayers = new Map((rows.players as unknown as Doc<"players">[]).map((p) => [p._id, p]));
  const players = await ctx.db
    .query("players")
    .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId))
    .collect();
  for (const player of players) {
    const before = snapPlayers.get(player._id);
    const target = before
      ? { auctionStatus: before.auctionStatus, teamId: before.teamId, soldPrice: before.soldPrice }
      : { auctionStatus: "pending" as const, teamId: undefined, soldPrice: undefined };
    if (
      player.auctionStatus !== target.auctionStatus ||
      player.teamId !== target.teamId ||
      player.soldPrice !== target.soldPrice
    ) {
      await ctx.db.patch(player._id, { ...target, updatedAt: now });
    }
  }

  const byRoom = (table: "liveBids" | "bids" | "auctionEvents", roomId: string) =>
    rows[table].filter((r) => r.auctionRoomId === roomId);
  for (const room of rows.auctionRooms as unknown as Doc<"auctionRooms">[]) {
    if (!(await ctx.db.get(room._id))) {
      missing.rooms++;
      continue;
    }
    await ctx.db.patch(room._id, {
      status: roomStatus(room.status),
      currentPlayerId: room.currentPlayerId,
      bidTimerEndsAt: undefined,
      pausedTimeRemaining: room.pausedTimeRemaining,
      auctionPhase: room.auctionPhase,
      roundNumber: room.roundNumber,
      unsoldQueue: room.unsoldQueue,
      unsoldCursor: room.unsoldCursor,
      unsoldRoundTotal: room.unsoldRoundTotal,
      roundStalled: room.roundStalled,
      currentSetId: room.currentSetId,
      updatedAt: now,
    });
    const [liveBids, bids, events, pending] = await Promise.all([
      ctx.db.query("liveBids").withIndex("by_room", (q) => q.eq("auctionRoomId", room._id)).collect(),
      ctx.db.query("bids").withIndex("by_auction_room", (q) => q.eq("auctionRoomId", room._id)).collect(),
      ctx.db.query("auctionEvents").withIndex("by_auction_room", (q) => q.eq("auctionRoomId", room._id)).collect(),
      ctx.db
        .query("bidRequests")
        .withIndex("by_room_player_status", (q) => q.eq("auctionRoomId", room._id))
        .collect(),
    ]);
    await Promise.all([
      ...[...liveBids, ...bids, ...events].map((doc) => ctx.db.delete(doc._id)),
      ...pending
        .filter((r) => r.status === "pending")
        .map((r) => ctx.db.patch(r._id, { status: "superseded" as const, reason: "Snapshot restored" })),
    ]);
    for (const row of byRoom("liveBids", room._id)) await ctx.db.insert("liveBids", withoutSystemFields(row) as never);
    for (const row of byRoom("bids", room._id)) await ctx.db.insert("bids", withoutSystemFields(row) as never);
    for (const row of byRoom("auctionEvents", room._id)) {
      await ctx.db.insert("auctionEvents", withoutSystemFields(row) as never);
    }
  }

  await syncTournamentAuctionCounts(ctx, tournamentId);
  return missing;
}

/**
 * Rewind a tournament to a snapshot (e.g. after a mistaken restart). Owners
 * only, never while the auction is live, with the tournament name typed. A
 * snapshot of the current state is taken first, so a restore can be undone.
 * Rooms that were live in the snapshot come back paused.
 */
export const restoreSnapshot = mutation({
  args: { snapshotId: v.id("tournamentSnapshots"), confirmName: v.string() },
  handler: async (ctx, args) => {
    const snapshot = await ctx.db.get(args.snapshotId);
    if (!snapshot) throw new Error("Snapshot not found");
    const owner = await requireTournamentRole(ctx, snapshot.tournamentId, OWNER_ONLY);
    const tournament = await ctx.db.get(snapshot.tournamentId);
    if (!tournament) throw new Error("Tournament not found");
    const rooms = await ctx.db
      .query("auctionRooms")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", snapshot.tournamentId))
      .collect();
    if (rooms.some((r) => r.status === "live")) throw new Error("Pause the auction before restoring a snapshot");
    if (!confirmsTournamentName(args.confirmName, tournament.name)) {
      throw new Error(`Type the tournament name (${tournament.name}) to confirm the restore`);
    }

    const undoSnapshotId = await takeSnapshot(ctx, snapshot.tournamentId, "before restore_snapshot", owner._id);
    const missing = await applySnapshot(ctx, snapshot, (status) => (status === "live" ? "paused" : status));
    await logAdminAction(ctx, {
      userId: owner._id,
      userEmail: owner.email,
      action: "restore_snapshot",
      targetType: "tournament",
      targetId: snapshot.tournamentId,
      newData: { snapshotId: snapshot._id, reason: snapshot.reason, undoSnapshotId, missing },
      tournamentId: snapshot.tournamentId,
    });
    return { success: true as const, undoSnapshotId, missing };
  },
});

// ── Rehearsal mode ───────────────────────────────────────────────────────────

/**
 * Start a practice auction: snapshot, then go live exactly like the real
 * start, flagged as a rehearsal (no WhatsApp; a banner on every screen).
 * Owners only, from a room that hasn't started.
 */
export const startRehearsal = mutation({
  args: { auctionRoomId: v.id("auctionRooms") },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.auctionRoomId);
    if (!room) throw new Error("Auction room not found");
    const owner = await requireTournamentRole(ctx, room.tournamentId, OWNER_ONLY);
    if (room.status !== "waiting") {
      throw new Error("A rehearsal can only start in a room that hasn't started. Restart the auction first.");
    }
    const snapshotId = await takeSnapshot(ctx, room.tournamentId, "before rehearsal", owner._id);
    await goLive(ctx, room);
    await ctx.db.patch(room._id, { rehearsal: true, rehearsalSnapshotId: snapshotId });
    await logAdminAction(ctx, {
      userId: owner._id,
      userEmail: owner.email,
      action: "start_rehearsal",
      targetType: "auction",
      targetId: room._id,
      newData: { snapshotId },
      tournamentId: room.tournamentId,
      auctionRoomId: room._id,
    });
    return { success: true as const, snapshotId };
  },
});

/** End the rehearsal: rewind everything to before it started. Owners only. */
export const endRehearsal = mutation({
  args: { auctionRoomId: v.id("auctionRooms") },
  handler: async (ctx, args) => {
    const room = await ctx.db.get(args.auctionRoomId);
    if (!room) throw new Error("Auction room not found");
    const owner = await requireTournamentRole(ctx, room.tournamentId, OWNER_ONLY);
    if (!room.rehearsal || !room.rehearsalSnapshotId) throw new Error("This room is not in a rehearsal");
    const snapshot = await ctx.db.get(room.rehearsalSnapshotId);
    if (!snapshot) throw new Error("The rehearsal's snapshot is missing; use Restart instead");

    const missing = await applySnapshot(ctx, snapshot, () => "waiting");
    await ctx.db.patch(room._id, { rehearsal: undefined, rehearsalSnapshotId: undefined });
    await logAdminAction(ctx, {
      userId: owner._id,
      userEmail: owner.email,
      action: "end_rehearsal",
      targetType: "auction",
      targetId: room._id,
      newData: { snapshotId: snapshot._id, missing },
      tournamentId: room.tournamentId,
      auctionRoomId: room._id,
    });
    return { success: true as const };
  },
});
