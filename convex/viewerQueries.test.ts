/// <reference types="vite/client" />
// Viewer queries (AUDIT 2026-10 P1-10, P1-12): the hot payload stays small
// whatever the round, and a deactivated tournament disappears for everyone
// but its staff.
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { syncTournamentAuctionCounts } from "./auctionCounts";

const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ADMIN_IDENTITY = { email: "admin@test.com", subject: "admin|1" };
const STRANGER = { email: "stranger@test.com", subject: "user|2" };

async function setup(t: ReturnType<typeof convexTest>, unsold = 0) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const adminId = await ctx.db.insert("users", { email: ADMIN_IDENTITY.email, role: "admin", createdAt: now });
    await ctx.db.insert("users", { email: STRANGER.email, role: "user", createdAt: now });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "View Cup",
      createdBy: adminId,
      status: "active",
      settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 3, basePrice: 100_000 },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("tournamentStaff", { tournamentId, userId: adminId, role: "owner", createdAt: now });
    const teamId = await ctx.db.insert("teams", {
      tournamentId,
      name: "Team A",
      ownerName: "Owner",
      logoUrl: "https://res.cloudinary.com/x/a.png",
      sponsorName: "Sponsor",
      purseRemaining: 1_000_000,
      purseSpent: 0,
      colorPrimary: "#111111",
      colorSecondary: "#222222",
      createdAt: now,
      updatedAt: now,
    });
    const queue: Id<"players">[] = [];
    for (let i = 0; i < unsold; i++) {
      queue.push(
        await ctx.db.insert("players", {
          tournamentId,
          name: `U${i}`,
          age: 25,
          role: "Batter",
          battingBowlingHand: "Right-handed",
          auctionStatus: "unsold",
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    const playerId = await ctx.db.insert("players", {
      tournamentId,
      name: "On Block",
      age: 25,
      role: "Batter",
      battingBowlingHand: "Right-handed",
      auctionStatus: "in_auction",
      createdAt: now,
      updatedAt: now,
    });
    const roomId = await ctx.db.insert("auctionRooms", {
      tournamentId,
      name: "Room",
      status: "live",
      currentPlayerId: playerId,
      auctionPhase: unsold ? "unsold" : "main",
      unsoldQueue: unsold ? queue : undefined,
      unsoldCursor: unsold ? 1 : undefined,
      unsoldRoundTotal: unsold ? queue.length : undefined,
      createdBy: adminId,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("liveBids", { auctionRoomId: roomId, playerId, teamId, amount: 100_000, timestamp: now });
    await ctx.db.insert("auctionEvents", {
      auctionRoomId: roomId,
      type: "player_unsold",
      data: { playerId: queue[0] ?? playerId, playerName: "U0", basePrice: 100_000 },
      timestamp: now,
    });
    await syncTournamentAuctionCounts(ctx, tournamentId);
    return { tournamentId, roomId, teamId, playerId };
  });
}

describe("getLiveAuction payload (P1-10)", () => {
  test("never ships the unsold queue or private room fields, and trims the leading team", async () => {
    const t = convexTest(schema, modules);
    const { roomId } = await setup(t, 300);

    const live = await t.query(api.auctions.getLiveAuction, { auctionRoomId: roomId });

    expect(live).not.toBeNull();
    expect(live!.auctionRoom).not.toHaveProperty("unsoldQueue");
    expect(live!.auctionRoom).not.toHaveProperty("createdBy");
    expect(live!.auctionRoom).toMatchObject({ unsoldCursor: 1, unsoldRoundTotal: 300, auctionPhase: "unsold" });
    expect(Object.keys(live!.currentBidTeam ?? {}).sort()).toEqual(["_id", "colorPrimary", "logoUrl", "name"]);
    // 300 queued players used to add ~10 KB to every bid for every viewer.
    expect(JSON.stringify(live).length).toBeLessThan(2_000);
  });
});

describe("deactivated tournaments (P1-12)", () => {
  async function hidden(t: ReturnType<typeof convexTest>) {
    const ids = await setup(t);
    await t.withIdentity(ADMIN_IDENTITY).mutation(api.tournaments.setActive, { id: ids.tournamentId, isActive: false });
    return ids;
  }

  test("every viewer query returns nothing to the public or a stranger", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, roomId, teamId, playerId } = await hidden(t);

    for (const caller of [t, t.withIdentity(STRANGER)]) {
      expect(await caller.query(api.auctions.getLiveAuction, { auctionRoomId: roomId })).toBeNull();
      expect(await caller.query(api.auctions.getAuctionRoster, { tournamentId, currentPlayerId: playerId })).toBeNull();
      expect(await caller.query(api.auctions.getLatestSaleEvent, { auctionRoomId: roomId })).toBeNull();
      expect(await caller.query(api.auctions.getAuctionHistory, { tournamentId })).toEqual({ sold: [], unsold: [] });
      expect(await caller.query(api.auctions.getAuctionRooms, { tournamentId })).toEqual([]);
      expect(await caller.query(api.groupDraws.getByTournament, { tournamentId })).toBeNull();
      expect(await caller.query(api.teams.getWithPlayers, { id: teamId })).toBeNull();
    }
  });

  test("its staff still see everything, and reactivating restores it for all", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, roomId, playerId } = await hidden(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);

    expect(await asAdmin.query(api.auctions.getLiveAuction, { auctionRoomId: roomId })).not.toBeNull();
    expect(await asAdmin.query(api.auctions.getAuctionRoster, { tournamentId, currentPlayerId: playerId })).not.toBeNull();

    await asAdmin.mutation(api.tournaments.setActive, { id: tournamentId, isActive: true });
    expect(await t.query(api.auctions.getLiveAuction, { auctionRoomId: roomId })).not.toBeNull();
  });

  test("a room created for a hidden tournament starts hidden", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, roomId } = await hidden(t);
    await t.run((ctx) => ctx.db.delete(roomId));

    const newRoom = await t
      .withIdentity(ADMIN_IDENTITY)
      .mutation(api.auctions.createAuctionRoom, { tournamentId, name: "Room 2" });

    expect(await t.query(api.auctions.getLiveAuction, { auctionRoomId: newRoom })).toBeNull();
  });
});

describe("viewer roster without the sold list (P1-11)", () => {
  async function withSold(t: ReturnType<typeof convexTest>, count: number) {
    const ids = await setup(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < count; i++) {
        await ctx.db.insert("players", {
          tournamentId: ids.tournamentId,
          name: `Sold Player Number ${i}`,
          age: 25,
          role: ["Batter", "Wicket Keeper"],
          battingBowlingHand: "Right-handed",
          auctionStatus: "sold",
          teamId: ids.teamId,
          soldPrice: 100_000,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      await syncTournamentAuctionCounts(ctx, ids.tournamentId);
    });
    return ids;
  }

  test("viewers get counts but not every sold player, so each player change stays small", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, playerId } = await withSold(t, 200);

    const full = (await t.query(api.auctions.getAuctionRoster, { tournamentId, currentPlayerId: playerId }))!;
    const viewer = (await t.query(api.auctions.getAuctionRoster, {
      tournamentId,
      currentPlayerId: playerId,
      includeSoldPlayers: false,
    }))!;

    expect(full.soldPlayers).toHaveLength(200);
    expect(viewer.soldPlayers).toEqual([]);
    expect(viewer.stats).toEqual(full.stats);
    expect(viewer.teams[0].playerCount).toBe(200);
    expect(JSON.stringify(viewer).length).toBeLessThan(4_000);
  });

  test("getSoldPlayers returns the trimmed sold list, and nothing for a hidden tournament", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, teamId } = await withSold(t, 3);

    const sold = await t.query(api.auctions.getSoldPlayers, { tournamentId });
    expect(sold).toHaveLength(3);
    const allowed = ["_id", "categoryId", "name", "role", "soldPrice", "teamId"];
    expect(Object.keys(sold[0]).every((k) => allowed.includes(k))).toBe(true);
    expect(sold[0]).toMatchObject({ teamId, soldPrice: 100_000 });
    expect(sold[0]).not.toHaveProperty("phoneNumber");

    await t.withIdentity(ADMIN_IDENTITY).mutation(api.tournaments.setActive, { id: tournamentId, isActive: false });
    expect(await t.query(api.auctions.getSoldPlayers, { tournamentId })).toEqual([]);
  });
});
