/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

// Discover the Convex function modules for the test runtime (see
// auctions.test.ts for why _generated must stay included).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const ADMIN_IDENTITY = { email: "admin@test.com", subject: "admin|1" };

/** Seed an admin user, a tournament, and a couple of players. */
async function setup(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const adminId = await ctx.db.insert("users", {
      email: ADMIN_IDENTITY.email,
      role: "admin",
      createdAt: now,
    });
    const mkTournament = (name: string) =>
      ctx.db.insert("tournaments", {
        name,
        createdBy: adminId,
        status: "setup",
        settings: {
          basePurse: 1_000_000,
          minBidIncrement: 25_000,
          bidTimerSeconds: 30,
          maxPlayersPerTeam: 5,
          basePrice: 100_000,
        },
        createdAt: now,
        updatedAt: now,
      });
    const tournamentId = await mkTournament("Test Cup");
    const otherTournamentId = await mkTournament("Other Cup");

    const mkPlayer = (tid: Id<"tournaments">, name: string) =>
      ctx.db.insert("players", {
        tournamentId: tid,
        name,
        age: 25,
        role: ["Batter", "Wicket Keeper"],
        battingBowlingHand: "Right-handed",
        auctionStatus: "pending",
        photoUrl: "https://example.com/photo.jpg",
        createdAt: now,
        updatedAt: now,
      });
    const playerId = await mkPlayer(tournamentId, "Rohit");
    const otherPlayerId = await mkPlayer(otherTournamentId, "Outsider");

    return { tournamentId, otherTournamentId, playerId, otherPlayerId };
  });
}

const baseTeamArgs = {
  name: "Team A",
  ownerName: "owner",
  colorPrimary: "#111111",
  colorSecondary: "#222222",
};

describe("teams captain from players", () => {
  test("create with captainPlayerId denormalizes captain fields from the player", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, playerId } = await setup(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);

    const teamId = await asAdmin.mutation(api.teams.create, {
      ...baseTeamArgs,
      tournamentId,
      captainPlayerId: playerId,
    });

    const team = await t.run((ctx) => ctx.db.get(teamId));
    expect(team!.captainPlayerId).toBe(playerId);
    expect(team!.captainName).toBe("Rohit");
    expect(team!.captainAge).toBe(25);
    expect(team!.captainRole).toBe("Batter");
    expect(team!.captainHand).toBe("Right");
    expect(team!.captainPhotoUrl).toBe("https://example.com/photo.jpg");
  });

  test("rejects a captain from a different tournament", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, otherPlayerId } = await setup(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);

    await expect(
      asAdmin.mutation(api.teams.create, {
        ...baseTeamArgs,
        tournamentId,
        captainPlayerId: otherPlayerId,
      }),
    ).rejects.toThrow(/player in this tournament/);
  });

  test("a player cannot captain two teams", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, playerId } = await setup(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);

    await asAdmin.mutation(api.teams.create, {
      ...baseTeamArgs,
      tournamentId,
      captainPlayerId: playerId,
    });

    await expect(
      asAdmin.mutation(api.teams.create, {
        ...baseTeamArgs,
        name: "Team B",
        tournamentId,
        captainPlayerId: playerId,
      }),
    ).rejects.toThrow(/already the captain/);
  });

  test("update can set and clear the captain link", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, playerId } = await setup(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);

    const teamId = await asAdmin.mutation(api.teams.create, {
      ...baseTeamArgs,
      tournamentId,
    });

    await asAdmin.mutation(api.teams.update, {
      id: teamId,
      captainPlayerId: playerId,
    });
    let team = await t.run((ctx) => ctx.db.get(teamId));
    expect(team!.captainPlayerId).toBe(playerId);
    expect(team!.captainName).toBe("Rohit");

    // null explicitly clears the link
    await asAdmin.mutation(api.teams.update, {
      id: teamId,
      captainPlayerId: null,
    });
    team = await t.run((ctx) => ctx.db.get(teamId));
    expect(team!.captainPlayerId).toBeUndefined();

    // ...and once cleared, another team may pick that player
    await asAdmin.mutation(api.teams.create, {
      ...baseTeamArgs,
      name: "Team B",
      tournamentId,
      captainPlayerId: playerId,
    });
  });

  test("deleting a player unlinks them as captain", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId, playerId } = await setup(t);
    const asAdmin = t.withIdentity(ADMIN_IDENTITY);

    const teamId = await asAdmin.mutation(api.teams.create, {
      ...baseTeamArgs,
      tournamentId,
      captainPlayerId: playerId,
    });

    await asAdmin.mutation(api.players.deletePlayer, { id: playerId });

    const team = await t.run((ctx) => ctx.db.get(teamId));
    expect(team!.captainPlayerId).toBeUndefined();
    // Display fields are kept, matching manual-entry behavior
    expect(team!.captainName).toBe("Rohit");
  });
});
