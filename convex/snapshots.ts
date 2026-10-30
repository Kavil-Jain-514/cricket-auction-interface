// convex/snapshots.ts - Automatic tournament snapshots (AUDIT 2026-10 P0-3).
// takeSnapshot copies every auction-state table for a tournament before a
// destructive action (restart, delete) and before the auction starts, so a
// mis-tap is recoverable. Rows are stored in chunks (snapshotChunks) to stay
// well under Convex's 1 MiB document limit for large rosters.
import { v } from "convex/values";
import { query, MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { RUN_AUCTION, requireTournamentRole } from "./auth";

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
