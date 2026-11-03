/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import { cloudinaryPublicId, RETENTION_MS } from "./fileCleanup";

// Phase 9: deleting a tournament removes its files too. Rows go at once;
// files, the safety snapshot and paid registrations go after RETENTION_MS.
// Fixtures follow auctions.test.ts (see there for why _generated stays in the glob).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const OWNER = { email: "owner@test.com", subject: "owner|1" };
const CLOUD = "demo";
const img = (path: string) => `https://res.cloudinary.com/${CLOUD}/image/upload/v1700000000/cricket-auction/${path}.jpg`;

describe("cloudinaryPublicId", () => {
  test.each([
    [img("players/abc"), "cricket-auction/players/abc"],
    [`https://res.cloudinary.com/${CLOUD}/image/upload/f_auto,q_auto,w_200/v1/cricket-auction/teams/x.png`, "cricket-auction/teams/x"],
    [`https://res.cloudinary.com/${CLOUD}/image/upload/cricket-auction/registrations/no-version.webp`, "cricket-auction/registrations/no-version"],
  ])("%s -> %s", (url, id) => {
    expect(cloudinaryPublicId(url, CLOUD)).toBe(id);
  });

  test.each([
    ["another cloud", "https://res.cloudinary.com/other/image/upload/v1/cricket-auction/players/a.jpg"],
    ["outside our folder", `https://res.cloudinary.com/${CLOUD}/image/upload/v1/samples/a.jpg`],
    ["not Cloudinary", "https://example.com/cricket-auction/players/a.jpg"],
    ["a video", `https://res.cloudinary.com/${CLOUD}/video/upload/v1/cricket-auction/a.mp4`],
  ])("ignores %s", (_label, url) => {
    expect(cloudinaryPublicId(url, CLOUD)).toBeNull();
  });
});

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const owner = await ctx.db.insert("users", { email: OWNER.email, createdAt: now });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Purge Cup",
      createdBy: owner,
      status: "setup",
      logoUrl: img("tournaments/logo"),
      sponsors: [{ name: "Acme", logoUrl: img("tournaments/acme") }, { name: "No Logo" }],
      settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5, paymentQrUrl: img("tournaments/qr") },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("tournamentStaff", { tournamentId, userId: owner, role: "owner", createdAt: now });
    const teamId = await ctx.db.insert("teams", {
      tournamentId,
      name: "Strikers",
      ownerName: "Owen",
      logoUrl: img("teams/strikers"),
      captainPhotoUrl: img("players/captain"),
      purseRemaining: 1_000_000,
      purseSpent: 0,
      colorPrimary: "#111111",
      colorSecondary: "#222222",
      createdAt: now,
      updatedAt: now,
    });
    const roomId = await ctx.db.insert("auctionRooms", { tournamentId, name: "Room", status: "waiting", createdBy: owner, createdAt: now, updatedAt: now });
    await ctx.db.insert("presence", { userId: owner, auctionRoomId: roomId, tournamentId, role: "console", lastSeen: now });
    const playerId = await ctx.db.insert("players", {
      tournamentId,
      name: "Ravi",
      age: 24,
      role: ["Bowler"],
      battingBowlingHand: "Right-handed",
      phoneNumber: "9876543210",
      photoUrl: img("players/ravi"),
      auctionStatus: "pending",
      createdAt: now,
      updatedAt: now,
    });
    const registration = (fields: Record<string, unknown>) =>
      ctx.db.insert("registrations", {
        tournamentId,
        name: "Ravi",
        age: 24,
        role: ["Bowler"],
        battingBowlingHand: "Right-handed",
        phoneNumber: "9876543210",
        consentWhatsApp: true,
        status: "paid",
        fee: 250,
        createdAt: now,
        ...fields,
      });
    await registration({ photoUrl: img("registrations/photo1"), answers: { formVersion: 1, values: [{ questionId: "q_id", value: img("registrations/idcard") }] } });
    const paidRegistration = await registration({ paymentProofUrl: img("registrations/proof"), paymentRef: "pay_1" });
    await ctx.db.insert("registrationOrders", { registrationId: paidRegistration, tournamentId, razorpayOrderId: "order_1", amount: 25_000, status: "paid", paymentRef: "pay_1", createdAt: now });
    await ctx.db.insert("teamRequests", {
      tournamentId,
      userId: owner,
      name: "Late XI",
      ownerName: "Lee",
      logoUrl: img("teams/late"),
      colorPrimary: "#111111",
      colorSecondary: "#222222",
      status: "pending",
      createdAt: now,
    });
    await ctx.db.insert("notifications", {
      kind: "player_sold",
      dedupeKey: `sold:${playerId}:${teamId}`,
      tournamentId,
      playerId,
      payload: { playerName: "Ravi", phoneNumber: "9876543210", tournamentName: "Purge Cup", teamName: "Strikers", ownerName: "Owen", soldPrice: 1 },
      status: "sent",
      attempts: 1,
      nextAttemptAt: now,
      createdAt: now,
    });
    return { tournamentId, playerId, paidRegistration };
  });
}

const deleteIt = (t: ReturnType<typeof convexTest>, id: Id<"tournaments">) =>
  t.withIdentity(OWNER).mutation(api.tournaments.deleteTournament, { id, confirmName: "Purge Cup" });

const EXPECTED_FILES = [
  "players/captain", "players/ravi", "registrations/idcard", "registrations/photo1", "registrations/proof",
  "teams/late", "teams/strikers", "tournaments/acme", "tournaments/logo", "tournaments/qr",
].map(img);

describe("deleting a tournament", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
    process.env.CLOUDINARY_API_KEY = "key";
    process.env.CLOUDINARY_API_SECRET = "secret";
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
  });

  test("removes rows with personal data at once and queues every file for after the retention period", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await seed(t);
    await deleteIt(t, tournamentId);

    const left = await t.run(async (ctx) => ({
      requests: await ctx.db.query("teamRequests").collect(),
      notifications: await ctx.db.query("notifications").collect(),
      presence: await ctx.db.query("presence").collect(),
      registrations: await ctx.db.query("registrations").collect(),
      files: await ctx.db.query("fileCleanup").collect(),
      purges: await ctx.db.query("tournamentPurges").collect(),
    }));
    expect([left.requests, left.notifications, left.presence].map((r) => r.length)).toEqual([0, 0, 0]);
    expect(left.registrations.map((r) => r.paymentRef)).toEqual(["pay_1"]); // refund trail, for now
    expect(left.files.map((f) => f.url).sort()).toEqual(EXPECTED_FILES);
    // Held until the purge: the snapshot still points at them until then.
    expect(left.files.every((f) => f.status === "waiting")).toBe(true);
    expect(left.purges.map((p) => [p.status, p.purgeAt])).toEqual([["scheduled", Date.now() + RETENTION_MS]]);
  });

  test("nothing is purged before the retention period; after it, snapshot and paid registrations go, payment orders stay", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await seed(t);
    await deleteIt(t, tournamentId);
    const fetchMock = vi.fn(async () => Response.json({ deleted: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await t.mutation(internal.fileCleanup.purgeDueTournaments, {});
    await t.action(internal.fileCleanup.processDue, {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query("tournamentSnapshots").collect())).toHaveLength(1);

    vi.advanceTimersByTime(RETENTION_MS + 1);
    await t.mutation(internal.fileCleanup.purgeDueTournaments, {});
    const left = await t.run(async (ctx) => ({
      snapshots: await ctx.db.query("tournamentSnapshots").collect(),
      chunks: await ctx.db.query("snapshotChunks").collect(),
      registrations: await ctx.db.query("registrations").collect(),
      orders: await ctx.db.query("registrationOrders").collect(),
      purge: (await ctx.db.query("tournamentPurges").collect())[0],
    }));
    expect([left.snapshots, left.chunks, left.registrations].map((r) => r.length)).toEqual([0, 0, 0]);
    expect(left.orders.map((o) => [o.paymentRef, o.amount])).toEqual([["pay_1", 25_000]]);
    expect(left.purge.status).toBe("done");
    // The files are now due for the worker.
    expect((await t.run((ctx) => ctx.db.query("fileCleanup").collect())).every((f) => f.status === "pending")).toBe(true);
    // Running it again changes nothing.
    await t.mutation(internal.fileCleanup.purgeDueTournaments, {});
  });

  test("the worker deletes due files from Cloudinary in batches and marks them done; not_found counts as done", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await seed(t);
    await deleteIt(t, tournamentId);
    vi.advanceTimersByTime(RETENTION_MS + 1);
    await t.mutation(internal.fileCleanup.purgeDueTournaments, {});
    const fetchMock = vi.fn(async (url: string | URL) => {
      const ids = new URL(String(url)).searchParams.getAll("public_ids[]");
      return Response.json({ deleted: Object.fromEntries(ids.map((id, i) => [id, i === 0 ? "not_found" : "deleted"])) });
    });
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.fileCleanup.processDue, {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`https://api.cloudinary.com/v1_1/${CLOUD}/resources/image/upload?`);
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa("key:secret")}`);
    const files = await t.run((ctx) => ctx.db.query("fileCleanup").collect());
    expect(files.every((f) => f.status === "done")).toBe(true);

    await t.action(internal.fileCleanup.processDue, {});
    expect(fetchMock).toHaveBeenCalledTimes(1); // idempotent: nothing left to do
  });

  test("a file another tournament still uses is never deleted", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await seed(t);
    await t.run(async (ctx) => {
      const now = Date.now();
      const owner = (await ctx.db.query("users").first())!._id;
      const other = await ctx.db.insert("tournaments", { name: "Other", createdBy: owner, status: "setup", settings: { basePurse: 1, minBidIncrement: 1, maxPlayersPerTeam: 1 }, createdAt: now, updatedAt: now });
      await ctx.db.insert("players", { tournamentId: other, name: "Ravi", age: 24, role: ["Bowler"], battingBowlingHand: "Right-handed", photoUrl: img("players/ravi"), auctionStatus: "pending", createdAt: now, updatedAt: now });
    });
    await deleteIt(t, tournamentId);
    vi.advanceTimersByTime(RETENTION_MS + 1);
    await t.mutation(internal.fileCleanup.purgeDueTournaments, {});
    const fetchMock = vi.fn(async () => Response.json({ deleted: {} }));
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.fileCleanup.processDue, {});
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(new URL(url).searchParams.getAll("public_ids[]")).not.toContain("cricket-auction/players/ravi");
    const shared = (await t.run((ctx) => ctx.db.query("fileCleanup").collect())).find((f) => f.url === img("players/ravi"));
    expect(shared?.status).toBe("in_use");
  });

  test("a failing Cloudinary call is retried with backoff, then dead-lettered as failed", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await seed(t);
    await deleteIt(t, tournamentId);
    vi.advanceTimersByTime(RETENTION_MS + 1);
    await t.mutation(internal.fileCleanup.purgeDueTournaments, {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));

    for (let i = 0; i < 12; i++) {
      await t.action(internal.fileCleanup.processDue, {});
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    }
    const files = await t.run((ctx) => ctx.db.query("fileCleanup").collect());
    expect(files.every((f) => f.status === "failed" && f.lastError?.includes("500"))).toBe(true);
    expect(await t.withIdentity({ email: "nobody@test.com", subject: "n|1" }).query(api.fileCleanup.stats, {})).toBeNull();
  });

  test("the same file queued twice is one row", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await seed(t);
    await t.run(async (ctx) => {
      const team = (await ctx.db.query("teams").first())!;
      await ctx.db.patch(team._id, { logoUrl: img("tournaments/logo") }); // same as the tournament logo
    });
    await deleteIt(t, tournamentId);
    const files = await t.run((ctx) => ctx.db.query("fileCleanup").collect());
    expect(files.filter((f) => f.url === img("tournaments/logo"))).toHaveLength(1);
  });
});

describe("orphan tools (files left by deletions before this existed)", () => {
  beforeEach(() => {
    process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
    process.env.CLOUDINARY_API_KEY = "key";
    process.env.CLOUDINARY_API_SECRET = "secret";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
  });

  const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const fresh = new Date().toISOString();
  const resource = (id: string, created = old) => ({ public_id: `cricket-auction/${id}`, created_at: created, bytes: 1000, secure_url: img(id) });

  function stubCloudinary(resources: ReturnType<typeof resource>[]) {
    const deletes: string[][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const u = new URL(String(url));
        if (init?.method === "DELETE") {
          const ids = u.searchParams.getAll("public_ids[]");
          deletes.push(ids);
          return Response.json({ deleted: Object.fromEntries(ids.map((id) => [id, "deleted"])) });
        }
        // Two pages, to exercise next_cursor.
        const second = u.searchParams.get("next_cursor") === "page2";
        const half = Math.ceil(resources.length / 2);
        return Response.json(second ? { resources: resources.slice(half) } : { resources: resources.slice(0, half), next_cursor: "page2" });
      }),
    );
    return deletes;
  }

  test("findOrphans is a dry run: reports unreferenced files older than a day, deletes nothing", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const deletes = stubCloudinary([resource("players/ravi"), resource("players/gone"), resource("teams/gone2"), resource("players/uploading", fresh)]);
    const report = await t.action(internal.fileCleanup.findOrphans, {});
    expect(report).toMatchObject({ stored: 4, orphanCount: 2, orphanBytes: 2000 });
    expect(report.orphans.map((o) => o.publicId).sort()).toEqual(["cricket-auction/players/gone", "cricket-auction/teams/gone2"]);
    expect(deletes).toEqual([]);
  });

  test("deleteOrphans deletes only approved ids that are still orphans", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const deletes = stubCloudinary([resource("players/ravi"), resource("players/gone"), resource("players/uploading", fresh)]);
    const result = await t.action(internal.fileCleanup.deleteOrphans, {
      publicIds: ["cricket-auction/players/gone", "cricket-auction/players/ravi", "cricket-auction/players/uploading", "cricket-auction/players/never-existed"],
    });
    expect(deletes).toEqual([["cricket-auction/players/gone"]]);
    expect(result).toEqual({
      deleted: ["cricket-auction/players/gone"],
      kept: ["cricket-auction/players/ravi", "cricket-auction/players/uploading", "cricket-auction/players/never-existed"],
    });
  });
});
