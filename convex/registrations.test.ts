/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { cloudinarySignature } from "./cloudinarySignature";

// Step 19: public player registration with an optional fee. Fixtures follow
// auctions.test.ts (see there for why _generated stays in the glob).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const OWNER = { email: "owner@test.com", subject: "owner|1" };
const OTHER = { email: "other@test.com", subject: "other|1" };
const SECRET = "whsec_test";

type Settings = Doc<"tournaments">["settings"];

async function setup(t: ReturnType<typeof convexTest>, settings: Partial<Settings> = {}) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { email: OWNER.email, createdAt: now });
    await ctx.db.insert("users", { email: OTHER.email, createdAt: now });
    const tournamentId = await ctx.db.insert("tournaments", {
      name: "Open Cup",
      createdBy: ownerId,
      status: "setup",
      settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5, registrationOpen: true, ...settings },
      plan: { tier: "free", maxTeams: 4, maxPlayers: 60 },
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("tournamentStaff", { tournamentId, userId: ownerId, role: "owner", createdAt: now });
    return { tournamentId };
  });
}

const entry = (over: Record<string, unknown> = {}) => ({
  name: "Ravi Kumar",
  age: 24,
  role: ["Bowler"],
  battingBowlingHand: "Right-handed" as const,
  phoneNumber: "9876543210",
  consentWhatsApp: true,
  website: "",
  ...over,
});

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function paid(t: ReturnType<typeof convexTest>, orderId: string, paymentId: string, amount: number, registrationId: string) {
  const body = JSON.stringify({
    event: "order.paid",
    payload: {
      payment: { entity: { id: paymentId, amount, order_id: orderId } },
      order: { entity: { id: orderId, amount, notes: { registrationId } } },
    },
  });
  return await t.fetch("/razorpay/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Razorpay-Signature": await hmacHex(SECRET, body) },
    body,
  });
}

beforeEach(() => {
  process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
});

const registrations = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("registrations").collect());

describe("public submission", () => {
  test("anonymous submission works while registration is open; free = ready for review", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const res = await t.mutation(api.registrations.submit, { tournamentId, ...entry() });
    expect(res).toMatchObject({ success: true, needsPayment: false });
    expect(await registrations(t)).toMatchObject([{ name: "Ravi Kumar", status: "paid", phoneNumber: "9876543210", consentWhatsApp: true }]);
  });

  test("cannot set auctionStatus, basePrice or categoryId", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    for (const sneaky of [{ auctionStatus: "sold" }, { basePrice: 1 }, { categoryId: "marquee" }]) {
      await expect(t.mutation(api.registrations.submit, { tournamentId, ...entry(sneaky) } as never)).rejects.toThrow();
    }
    expect(await registrations(t)).toHaveLength(0);
  });

  test("closed registration, invalid fields and duplicates are refused", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { registrationOpen: false });
    await expect(t.mutation(api.registrations.submit, { tournamentId, ...entry() })).rejects.toThrow(/closed/);

    const open = convexTest(schema, modules);
    const o = await setup(open);
    await expect(open.mutation(api.registrations.submit, { tournamentId: o.tournamentId, ...entry({ age: 2 }) })).rejects.toThrow(/Age/);
    await open.mutation(api.registrations.submit, { tournamentId: o.tournamentId, ...entry() });
    await expect(
      open.mutation(api.registrations.submit, { tournamentId: o.tournamentId, ...entry({ name: "ravi kumar", phoneNumber: "+91 98765 43210" }) }),
    ).rejects.toThrow(/already registered/);
  });

  test("the honeypot silently drops bots", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const res = await t.mutation(api.registrations.submit, { tournamentId, ...entry({ website: "http://spam" }) });
    expect(res).toMatchObject({ success: true });
    expect(await registrations(t)).toHaveLength(0);
  });

  test("rate limit: 3 submissions per phone per tournament per day", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    for (const name of ["Player One", "Player Two", "Player Three"]) {
      await t.mutation(api.registrations.submit, { tournamentId, ...entry({ name }) });
    }
    await expect(t.mutation(api.registrations.submit, { tournamentId, ...entry({ name: "Player Four" }) })).rejects.toThrow(/Too many/);
  });

  test("photos must be Cloudinary uploads", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await expect(t.mutation(api.registrations.submit, { tournamentId, ...entry({ photoUrl: "https://evil.example/x.png" }) })).rejects.toThrow(/photo/i);
  });
});

describe("registration fee", () => {
  test("a fee makes it pending_payment; the signed webhook marks it paid, once", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { registrationFee: 300 });
    const res = await t.mutation(api.registrations.submit, { tournamentId, ...entry() });
    expect(res).toMatchObject({ success: true, needsPayment: true, fee: 300 });
    const registrationId = res.registrationId as Id<"registrations">;

    await expect(t.mutation(api.registrations.recordOrder, { registrationId, razorpayOrderId: "o1", amount: 100 })).rejects.toThrow(/amount/);
    await t.mutation(api.registrations.recordOrder, { registrationId, razorpayOrderId: "o1", amount: 30_000 });

    expect((await paid(t, "o1", "pay_1", 30_000, registrationId)).status).toBe(200);
    expect((await paid(t, "o1", "pay_1", 30_000, registrationId)).status).toBe(200);
    const [reg] = await registrations(t);
    expect(reg).toMatchObject({ status: "paid", paymentRef: "pay_1" });
  });

  test("a mismatched amount doesn't mark it paid", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { registrationFee: 300 });
    const res = await t.mutation(api.registrations.submit, { tournamentId, ...entry() });
    const registrationId = res.registrationId as Id<"registrations">;
    await t.mutation(api.registrations.recordOrder, { registrationId, razorpayOrderId: "o1", amount: 30_000 });
    await paid(t, "o1", "pay_1", 1, registrationId);
    expect((await registrations(t))[0].status).toBe("pending_payment");
  });
});

describe("organiser review", () => {
  test("approve creates a validated pending player; unpaid can't be approved", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { registrationFee: 300 });
    const unpaid = (await t.mutation(api.registrations.submit, { tournamentId, ...entry() })).registrationId as Id<"registrations">;
    const asOwner = t.withIdentity(OWNER);
    await expect(asOwner.mutation(api.registrations.approve, { registrationId: unpaid })).rejects.toThrow(/paid/);

    await t.run((ctx) => ctx.db.patch(unpaid, { status: "paid" }));
    const playerId = await asOwner.mutation(api.registrations.approve, { registrationId: unpaid });
    const player = await t.run((ctx) => ctx.db.get(playerId));
    expect(player).toMatchObject({ name: "Ravi Kumar", auctionStatus: "pending", playerNumber: 1 });
    expect(player?.basePrice).toBeUndefined();
    expect((await registrations(t))[0]).toMatchObject({ status: "approved", playerId });
  });

  test("approval runs player validation and the plan's limits", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const id = (await t.mutation(api.registrations.submit, { tournamentId, ...entry() })).registrationId as Id<"registrations">;
    await t.run(async (ctx) => {
      await ctx.db.patch(id, { age: 200 }); // data that would no longer pass validation
    });
    await expect(t.withIdentity(OWNER).mutation(api.registrations.approve, { registrationId: id })).rejects.toThrow(/Age/);
  });

  test("reject with a reason; bulk approve only ready ones", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const asOwner = t.withIdentity(OWNER);
    const a = (await t.mutation(api.registrations.submit, { tournamentId, ...entry({ name: "Alpha One", phoneNumber: "9000000001" }) })).registrationId as Id<"registrations">;
    await t.mutation(api.registrations.submit, { tournamentId, ...entry({ name: "Beta Two", phoneNumber: "9000000002" }) });
    await t.mutation(api.registrations.submit, { tournamentId, ...entry({ name: "Gamma Three", phoneNumber: "9000000003" }) });

    await expect(asOwner.mutation(api.registrations.reject, { registrationId: a, reason: " " })).rejects.toThrow(/reason/);
    await asOwner.mutation(api.registrations.reject, { registrationId: a, reason: "Not from the club" });
    expect(await asOwner.mutation(api.registrations.bulkApprove, { tournamentId })).toEqual({ approved: 2, failed: [] });
    expect(await t.run((ctx) => ctx.db.query("players").collect())).toHaveLength(2);
  });

  test("the review list flags duplicates and is owner-only", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("players", {
        tournamentId, name: "Ravi Kumar", age: 24, role: ["Bowler"], battingBowlingHand: "Right-handed", phoneNumber: "9876543210",
        auctionStatus: "pending", createdAt: Date.now(), updatedAt: Date.now(),
      });
    });
    // Submission catches the existing player too.
    await expect(t.mutation(api.registrations.submit, { tournamentId, ...entry() })).rejects.toThrow(/already registered/);

    await t.mutation(api.registrations.submit, { tournamentId, ...entry({ name: "Someone Else", phoneNumber: "9111111111" }) });
    const list = await t.withIdentity(OWNER).query(api.registrations.list, { tournamentId });
    expect(list).toHaveLength(1);
    await expect(t.withIdentity(OTHER).query(api.registrations.list, { tournamentId })).rejects.toThrow(/access to this tournament/);
  });
});

describe("public info", () => {
  test("shows name, fee and whether it's open; nothing private", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { registrationFee: 250 });
    expect(await t.query(api.registrations.getPublicInfo, { tournamentId })).toEqual({ name: "Open Cup", logoUrl: undefined, open: true, fee: 250 });
  });
});

describe("cloudinarySignature", () => {
  test("matches Cloudinary's documented example", async () => {
    // https://cloudinary.com/documentation/authentication_signatures
    expect(
      await cloudinarySignature({ eager: "w_400,h_300,c_pad|w_260,h_200,c_crop", public_id: "sample_image", timestamp: 1315060510 }, "abcd"),
    ).toBe("bfd09f95f331f558cbd1320e67aa8d488770583e");
  });
});

describe("tournaments.update — registration settings", () => {
  test("owners open/close registration and set the fee, even while live", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { registrationOpen: false });
    await t.run(async (ctx) => {
      const tournament = (await ctx.db.get(tournamentId))!;
      await ctx.db.insert("auctionRooms", { tournamentId, name: "R", status: "live", createdBy: tournament.createdBy, createdAt: Date.now(), updatedAt: Date.now() });
    });
    const asOwner = t.withIdentity(OWNER);
    const base = (await t.run((ctx) => ctx.db.get(tournamentId)))!.settings;

    await asOwner.mutation(api.tournaments.update, { id: tournamentId, settings: { ...base, registrationOpen: true, registrationFee: 300 } });
    expect((await t.run((ctx) => ctx.db.get(tournamentId)))?.settings).toMatchObject({ registrationOpen: true, registrationFee: 300 });

    await expect(
      asOwner.mutation(api.tournaments.update, { id: tournamentId, settings: { ...base, registrationOpen: true, registrationFee: -5 } }),
    ).rejects.toThrow(/fee/);
  });
});

describe("several orders for one registration (AUDIT 2026-10 P1-8)", () => {
  test("paying the first of two checkouts still marks the registration paid", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { registrationFee: 300 });
    const res = await t.mutation(api.registrations.submit, { tournamentId, ...entry() });
    const registrationId = res.registrationId as Id<"registrations">;
    await t.mutation(api.registrations.recordOrder, { registrationId, razorpayOrderId: "o1", amount: 30_000 });
    await t.mutation(api.registrations.recordOrder, { registrationId, razorpayOrderId: "o2", amount: 30_000 });

    await paid(t, "o1", "pay_1", 30_000, registrationId);

    expect((await registrations(t))[0]).toMatchObject({ status: "paid", paymentRef: "pay_1" });
  });

  test("a second payment, or one after a rejection, is kept as refund due", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { registrationFee: 300 });
    const a = await t.mutation(api.registrations.submit, { tournamentId, ...entry() });
    const b = await t.mutation(api.registrations.submit, { tournamentId, ...entry({ name: "Second", phoneNumber: "9876500000" }) });
    const regA = a.registrationId as Id<"registrations">;
    const regB = b.registrationId as Id<"registrations">;
    for (const [registrationId, order] of [[regA, "o1"], [regA, "o2"], [regB, "o3"]] as const) {
      await t.mutation(api.registrations.recordOrder, { registrationId, razorpayOrderId: order, amount: 30_000 });
    }
    await t.withIdentity(OWNER).mutation(api.registrations.reject, { registrationId: regB, reason: "Team full" });

    await paid(t, "o1", "pay_1", 30_000, regA);
    await paid(t, "o2", "pay_2", 30_000, regA);
    await paid(t, "o3", "pay_3", 30_000, regB);

    const due = await t.withIdentity(OWNER).query(api.registrations.listRefundsDue, { tournamentId });
    expect(due.map((d) => d.paymentRef).sort()).toEqual(["pay_2", "pay_3"]);
    expect((await registrations(t)).find((r) => r._id === regA)).toMatchObject({ status: "paid", paymentRef: "pay_1" });
    await expect(t.withIdentity(OTHER).query(api.registrations.listRefundsDue, { tournamentId })).rejects.toThrow(/access/);
  });
});

describe("abuse limits on the public form (AUDIT 2026-10 P1-9)", () => {
  test("submissions are rate-limited per tournament, whatever the phone", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    for (let i = 0; i < 30; i++) {
      await t.mutation(api.registrations.submit, {
        tournamentId,
        ...entry({ name: `Player ${i}`, phoneNumber: `98765${String(i).padStart(5, "0")}` }),
      });
    }

    await expect(
      t.mutation(api.registrations.submit, { tournamentId, ...entry({ name: "One More", phoneNumber: "9111111111" }) }),
    ).rejects.toThrow(/Too many registrations right now/);
    expect(await registrations(t)).toHaveLength(30);
  });

  test("a duplicate of an existing player is still caught by name and phone", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.run((ctx) =>
      ctx.db.insert("players", {
        tournamentId,
        name: "Ravi Kumar",
        phoneNumber: "9876543210",
        age: 24,
        role: ["Bowler"],
        battingBowlingHand: "Right-handed",
        auctionStatus: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await expect(t.mutation(api.registrations.submit, { tournamentId, ...entry() })).rejects.toThrow(/already registered/);
  });

  test("photo upload signatures are rate-limited per tournament", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    Object.assign(process.env, { CLOUDINARY_CLOUD_NAME: "c", CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s" });
    try {
      for (let i = 0; i < 60; i++) await t.action(api.registrations.getUploadSignature, { tournamentId });
      await expect(t.action(api.registrations.getUploadSignature, { tournamentId })).rejects.toThrow(/Too many uploads/);
    } finally {
      delete process.env.CLOUDINARY_CLOUD_NAME;
      delete process.env.CLOUDINARY_API_KEY;
      delete process.env.CLOUDINARY_API_SECRET;
    }
  });

  test("getPaymentInfo says how many checkouts are left, so the order route can refuse early", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { registrationFee: 300 });
    const res = await t.mutation(api.registrations.submit, { tournamentId, ...entry() });
    const registrationId = res.registrationId as Id<"registrations">;
    await t.mutation(api.registrations.recordOrder, { registrationId, razorpayOrderId: "o1", amount: 30_000 });

    expect(await t.query(api.registrations.getPaymentInfo, { registrationId })).toMatchObject({ ordersLeft: 9 });
  });
});
