/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import type { Doc, Id } from "./_generated/dataModel";
import { cloudinarySignature } from "./cloudinarySignature";
import { perShardLimit, RATE_LIMIT_SHARDS } from "./shardedRateLimit";
import { SUBMIT_LIMIT, UPLOAD_DAILY_LIMIT, UPLOAD_SIGNATURE_LIMIT } from "./registrations";

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

const QR = "https://res.cloudinary.com/demo/image/upload/qr.png";
const PROOF = "https://res.cloudinary.com/demo/image/upload/proof.png";
const CATEGORIES: Settings["categories"] = [
  { id: "b", name: "Category B", basePrice: 50_000, order: 2, colour: "#22c55e" },
  { id: "a", name: "Category A", basePrice: 100_000, order: 1, colour: "#3b82f6" },
];

const registrations = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("registrations").collect());

describe("public submission", () => {
  test("anonymous submission works while registration is open; free = ready for review", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const res = await t.mutation(api.registrations.submit, { tournamentId, ...entry() });
    expect(res).toMatchObject({ success: true, needsPayment: false });
    expect(await registrations(t)).toMatchObject([{ name: "Ravi Kumar", status: "paid", phoneNumber: "9876543210", consentWhatsApp: true }]);
  });

  test("cannot set auctionStatus or basePrice", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    for (const sneaky of [{ auctionStatus: "sold" }, { basePrice: 1 }]) {
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

describe("QR and offline payment", () => {
  test("a screenshot of the QR payment makes it ready for review", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { registrationFee: 300, paymentQrUrl: QR });
    const registrationId = (await t.mutation(api.registrations.submit, { tournamentId, ...entry() })).registrationId as Id<"registrations">;

    await expect(t.mutation(api.registrations.submitPaymentProof, { registrationId, proofUrl: "https://evil.example/x.png" })).rejects.toThrow(/screenshot/i);
    await t.mutation(api.registrations.submitPaymentProof, { registrationId, proofUrl: PROOF });
    expect((await registrations(t))[0]).toMatchObject({ status: "paid", paymentMethod: "qr", paymentProofUrl: PROOF });
    await expect(t.mutation(api.registrations.submitPaymentProof, { registrationId, proofUrl: PROOF })).rejects.toThrow(/Nothing to pay/);
  });

  test("no QR set: a screenshot is refused", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { registrationFee: 300 });
    const registrationId = (await t.mutation(api.registrations.submit, { tournamentId, ...entry() })).registrationId as Id<"registrations">;
    await expect(t.mutation(api.registrations.submitPaymentProof, { registrationId, proofUrl: PROOF })).rejects.toThrow(/QR/);
  });

  test("offline: stays unpaid until the owner marks the fee received", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { registrationFee: 300 });
    const registrationId = (await t.mutation(api.registrations.submit, { tournamentId, ...entry() })).registrationId as Id<"registrations">;
    await t.mutation(api.registrations.chooseOfflinePayment, { registrationId });
    expect((await registrations(t))[0]).toMatchObject({ status: "pending_payment", paymentMethod: "offline" });

    await expect(t.withIdentity(OTHER).mutation(api.registrations.markPaid, { registrationId })).rejects.toThrow(/access to this tournament/);
    await t.withIdentity(OWNER).mutation(api.registrations.markPaid, { registrationId });
    expect((await registrations(t))[0]).toMatchObject({ status: "paid", paymentMethod: "offline" });
    await expect(t.withIdentity(OWNER).mutation(api.registrations.markPaid, { registrationId })).rejects.toThrow(/Already paid/);

    const logs = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(logs.map((l) => l.action)).toContain("mark_registration_paid");
  });
});

describe("self-selected category", () => {
  test("registrants pick a category; the player gets it on approval", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { categories: CATEGORIES });
    await expect(t.mutation(api.registrations.submit, { tournamentId, ...entry({ categoryId: "nope" }) })).rejects.toThrow(/category/i);
    const registrationId = (await t.mutation(api.registrations.submit, { tournamentId, ...entry({ categoryId: "b" }) })).registrationId as Id<"registrations">;
    expect((await registrations(t))[0].categoryId).toBe("b");

    const playerId = await t.withIdentity(OWNER).mutation(api.registrations.approve, { registrationId });
    expect((await t.run((ctx) => ctx.db.get(playerId)))?.categoryId).toBe("b");
  });

  test("the owner can change it before approval", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { categories: CATEGORIES });
    const registrationId = (await t.mutation(api.registrations.submit, { tournamentId, ...entry({ categoryId: "b" }) })).registrationId as Id<"registrations">;
    await expect(t.withIdentity(OTHER).mutation(api.registrations.setCategory, { registrationId, categoryId: "a" })).rejects.toThrow(/access to this tournament/);
    await expect(t.withIdentity(OWNER).mutation(api.registrations.setCategory, { registrationId, categoryId: "zzz" })).rejects.toThrow(/category/i);
    await t.withIdentity(OWNER).mutation(api.registrations.setCategory, { registrationId, categoryId: "a" });
    expect((await registrations(t))[0].categoryId).toBe("a");
    await t.withIdentity(OWNER).mutation(api.registrations.setCategory, { registrationId });
    expect((await registrations(t))[0].categoryId).toBeUndefined();
  });

  test("a category removed since registering is dropped on approval", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { categories: CATEGORIES });
    const registrationId = (await t.mutation(api.registrations.submit, { tournamentId, ...entry({ categoryId: "b" }) })).registrationId as Id<"registrations">;
    await t.run(async (ctx) => {
      const tournament = (await ctx.db.get(tournamentId))!;
      await ctx.db.patch(tournamentId, { settings: { ...tournament.settings, categories: CATEGORIES!.filter((c) => c.id !== "b") } });
    });
    const playerId = await t.withIdentity(OWNER).mutation(api.registrations.approve, { registrationId });
    expect((await t.run((ctx) => ctx.db.get(playerId)))?.categoryId).toBeUndefined();
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
    expect(await asOwner.mutation(api.registrations.bulkApprove, { tournamentId })).toMatchObject({ approved: 2, failed: [], remaining: 0 });
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
    expect(await t.query(api.registrations.getPublicInfo, { tournamentId })).toEqual({
      name: "Open Cup",
      description: undefined,
      logoUrl: undefined,
      open: true,
      format: "standard",
      onePerDevice: false,
      fee: 250,
      coupleFee: 250,
      paymentQrUrl: undefined,
      sponsors: [],
      categories: [],
      form: null,
      // Defaults: the standard details the original form required.
      requiredFields: { photo: false, age: true, role: true, category: false, tshirtSize: false, jerseyNumber: false, jerseyName: false },
      hiddenFields: [],
    });
  });

  test("lists categories (in order), the payment QR and sponsors", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { registrationFee: 250, paymentQrUrl: QR, categories: CATEGORIES });
    await t.run((ctx) => ctx.db.patch(tournamentId, { sponsors: [{ name: "Acme", logoUrl: "https://res.cloudinary.com/x/acme.png" }] }));
    expect(await t.query(api.registrations.getPublicInfo, { tournamentId })).toMatchObject({
      paymentQrUrl: QR,
      sponsors: [{ name: "Acme", logoUrl: "https://res.cloudinary.com/x/acme.png" }],
      categories: [{ id: "a", name: "Category A" }, { id: "b", name: "Category B" }],
    });
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

  test("the couple fee is saved and validated like the solo fee", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { format: "couple" });
    const asOwner = t.withIdentity(OWNER);
    const base = (await t.run((ctx) => ctx.db.get(tournamentId)))!.settings;
    await asOwner.mutation(api.tournaments.update, { id: tournamentId, settings: { ...base, registrationFee: 300, coupleRegistrationFee: 500 } });
    expect((await t.run((ctx) => ctx.db.get(tournamentId)))?.settings).toMatchObject({ registrationFee: 300, coupleRegistrationFee: 500 });
    for (const coupleRegistrationFee of [-5, 10.5, 100_001]) {
      await expect(
        asOwner.mutation(api.tournaments.update, { id: tournamentId, settings: { ...base, coupleRegistrationFee } }),
      ).rejects.toThrow(/fee/);
    }
  });

  test("payment QR: set, cleared with an empty string, must be an https image link", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const asOwner = t.withIdentity(OWNER);
    const base = (await t.run((ctx) => ctx.db.get(tournamentId)))!.settings;
    await asOwner.mutation(api.tournaments.update, { id: tournamentId, settings: { ...base, paymentQrUrl: QR } });
    expect((await t.run((ctx) => ctx.db.get(tournamentId)))?.settings.paymentQrUrl).toBe(QR);
    await expect(asOwner.mutation(api.tournaments.update, { id: tournamentId, settings: { ...base, paymentQrUrl: "javascript:alert(1)" } })).rejects.toThrow(/QR/);
    await asOwner.mutation(api.tournaments.update, { id: tournamentId, settings: { ...base, paymentQrUrl: "" } });
    expect((await t.run((ctx) => ctx.db.get(tournamentId)))?.settings.paymentQrUrl).toBeUndefined();
  });

  test("sponsors: trimmed, named and capped", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.tournaments.update, { id: tournamentId, sponsors: [{ name: "  Acme  " }] });
    expect((await t.run((ctx) => ctx.db.get(tournamentId)))?.sponsors).toEqual([{ name: "Acme" }]);
    await expect(asOwner.mutation(api.tournaments.update, { id: tournamentId, sponsors: [{ name: " " }] })).rejects.toThrow(/name/);
    await expect(
      asOwner.mutation(api.tournaments.update, { id: tournamentId, sponsors: Array.from({ length: 13 }, (_, i) => ({ name: `S${i}` })) }),
    ).rejects.toThrow(/12/);
    await expect(asOwner.mutation(api.tournaments.update, { id: tournamentId, sponsors: [{ name: "X", logoUrl: "http://x" }] })).rejects.toThrow(/logo/);
  });

  test("sponsors: an optional type, trimmed; blank is dropped; capped at 40", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.tournaments.update, {
      id: tournamentId,
      sponsors: [{ name: "Acme", type: "  Title Sponsor " }, { name: "Bolt", type: "   " }],
    });
    expect((await t.run((ctx) => ctx.db.get(tournamentId)))?.sponsors).toEqual([{ name: "Acme", type: "Title Sponsor" }, { name: "Bolt" }]);
    expect((await t.query(api.registrations.getPublicInfo, { tournamentId }))?.sponsors).toEqual([{ name: "Acme", type: "Title Sponsor" }, { name: "Bolt" }]);
    await expect(asOwner.mutation(api.tournaments.update, { id: tournamentId, sponsors: [{ name: "X", type: "x".repeat(41) }] })).rejects.toThrow(/type/i);
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
  // Only Date is faked, so every call lands in one fixed rate-limit window.
  const oneMinute = () => vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-19T10:00:05Z") });
  const withCloudinary = async (fn: () => Promise<void>) => {
    Object.assign(process.env, { CLOUDINARY_CLOUD_NAME: "c", CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s" });
    try {
      await fn();
    } finally {
      delete process.env.CLOUDINARY_CLOUD_NAME;
      delete process.env.CLOUDINARY_API_KEY;
      delete process.env.CLOUDINARY_API_SECRET;
    }
  };

  test("a rush of 50 registrations in one minute, each with a photo and a payment screenshot, all go through", async () => {
    oneMinute();
    try {
      const t = convexTest(schema, modules);
      const { tournamentId } = await setup(t, { registrationFee: 300, paymentQrUrl: QR });
      await withCloudinary(async () => {
        await Promise.all(
          Array.from({ length: 50 }, async (_, i) => {
            const upload = async () => {
              const sig = await t.action(api.registrations.getUploadSignature, { tournamentId });
              return `https://res.cloudinary.com/c/image/upload/v1/${sig.folder}/${sig.public_id}.jpg`;
            };
            const res = await t.mutation(api.registrations.submit, {
              tournamentId,
              ...entry({ name: `Player ${i}`, phoneNumber: `98765${String(i).padStart(5, "0")}`, photoUrl: await upload() }),
            });
            await t.mutation(api.registrations.submitPaymentProof, {
              registrationId: res.registrationId as Id<"registrations">,
              proofUrl: await upload(),
            });
          }),
        );
      });
      const rows = await registrations(t);
      expect(rows).toHaveLength(50);
      expect(rows.every((r) => r.status === "paid" && r.photoUrl && r.paymentProofUrl)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  // Sharded per-tournament limits (convex/shardedRateLimit.ts). convex-test
  // runs transactions one at a time, so these prove the caps and the
  // bookkeeping, not production OCC behaviour under real concurrency; that is
  // what scripts/loadtest/registrations.mjs is for.
  const phoneFor = (i: number) => `98765${String(i).padStart(5, "0")}`;
  const MINUTE = 60 * 1000;
  /** Fill every shard of `key` for the current window, as a rush would. */
  const fillShards = (t: ReturnType<typeof convexTest>, key: string, limit: number) =>
    t.run(async (ctx) => {
      const now = Date.now();
      for (let s = 0; s < RATE_LIMIT_SHARDS; s++) {
        await ctx.db.insert("rateLimits", { key: `${key}:${s}`, windowStart: now - (now % MINUTE), count: perShardLimit(limit) });
      }
    });
  const rateRows = (t: ReturnType<typeof convexTest>) =>
    t.run(async (ctx) => (await ctx.db.query("rateLimits").collect()).map(({ key, windowStart, count }) => ({ key, windowStart, count })));

  test("300 simultaneous registrations all go through", async () => {
    oneMinute();
    try {
      const t = convexTest(schema, modules);
      const { tournamentId } = await setup(t);
      const results = await Promise.all(
        Array.from({ length: 300 }, (_, i) =>
          t.mutation(api.registrations.submit, { tournamentId, ...entry({ name: `Player ${i}`, phoneNumber: phoneFor(i), consentWhatsApp: false }) }),
        ),
      );
      expect(results.every((r) => r.success)).toBe(true);
      expect(await registrations(t)).toHaveLength(300);
    } finally {
      vi.useRealTimers();
    }
  });

  test("submissions are still capped per tournament, whatever the phone; a refused one writes nothing", async () => {
    oneMinute();
    try {
      const t = convexTest(schema, modules);
      const { tournamentId } = await setup(t);
      await fillShards(t, `register:${tournamentId}`, SUBMIT_LIMIT.limit);
      const before = await rateRows(t);
      await expect(
        t.mutation(api.registrations.submit, { tournamentId, ...entry({ name: "One More", phoneNumber: "9111111111" }) }),
      ).rejects.toThrow(/Too many registrations right now/);
      expect(await registrations(t)).toHaveLength(0);
      expect(await rateRows(t)).toEqual(before);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a submit refused by validation doesn't use up the tournament's budget", async () => {
    oneMinute();
    try {
      const t = convexTest(schema, modules);
      const { tournamentId } = await setup(t);
      await expect(t.mutation(api.registrations.submit, { tournamentId, ...entry({ age: 2 }) })).rejects.toThrow(/Age/);
      expect(await rateRows(t)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("the per-tournament cap resets when the minute rolls over", async () => {
    oneMinute();
    try {
      const t = convexTest(schema, modules);
      const { tournamentId } = await setup(t);
      await fillShards(t, `register:${tournamentId}`, SUBMIT_LIMIT.limit);
      await expect(t.mutation(api.registrations.submit, { tournamentId, ...entry() })).rejects.toThrow(/Too many registrations right now/);
      vi.setSystemTime(new Date("2026-11-19T10:01:05Z"));
      await expect(t.mutation(api.registrations.submit, { tournamentId, ...entry() })).resolves.toMatchObject({ success: true });
    } finally {
      vi.useRealTimers();
    }
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

  test("450 simultaneous photo upload signatures all go through", async () => {
    oneMinute();
    try {
      const t = convexTest(schema, modules);
      const { tournamentId } = await setup(t);
      await withCloudinary(async () => {
        const sigs = await Promise.all(Array.from({ length: 450 }, () => t.action(api.registrations.getUploadSignature, { tournamentId })));
        expect(new Set(sigs.map((s) => s.public_id)).size).toBe(450);
      });
      expect(await t.run((ctx) => ctx.db.query("uploadGrants").collect())).toHaveLength(450);
    } finally {
      vi.useRealTimers();
    }
  });

  test("signatures are still capped per tournament; a refused one issues no grant and uses no daily budget", async () => {
    oneMinute();
    try {
      const t = convexTest(schema, modules);
      const { tournamentId } = await setup(t);
      await fillShards(t, `upload:${tournamentId}`, UPLOAD_SIGNATURE_LIMIT.limit);
      const before = await rateRows(t);
      await withCloudinary(async () => {
        await expect(t.action(api.registrations.getUploadSignature, { tournamentId })).rejects.toThrow(/Too many uploads right now/);
      });
      expect(await t.run((ctx) => ctx.db.query("uploadGrants").collect())).toHaveLength(0);
      expect(await rateRows(t)).toEqual(before);
    } finally {
      vi.useRealTimers();
    }
  });

  test("the daily upload cap still applies", async () => {
    oneMinute();
    try {
      const t = convexTest(schema, modules);
      const { tournamentId } = await setup(t);
      await t.run(async (ctx) => {
        const now = Date.now();
        const day = 24 * 60 * MINUTE;
        for (let s = 0; s < RATE_LIMIT_SHARDS; s++) {
          await ctx.db.insert("rateLimits", { key: `upload-day:${tournamentId}:${s}`, windowStart: now - (now % day), count: perShardLimit(UPLOAD_DAILY_LIMIT.limit) });
        }
      });
      await withCloudinary(async () => {
        await expect(t.action(api.registrations.getUploadSignature, { tournamentId })).rejects.toThrow(/Too many uploads right now/);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("signatures: closed registration and missing Cloudinary setup keep their messages, closed first", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { registrationOpen: false });
    await expect(t.action(api.registrations.getUploadSignature, { tournamentId })).rejects.toThrow(/Registration is closed/);
    await withCloudinary(async () => {
      await expect(t.action(api.registrations.getUploadSignature, { tournamentId })).rejects.toThrow(/Registration is closed/);
    });
    const open = convexTest(schema, modules);
    const o = await setup(open);
    await expect(open.action(api.registrations.getUploadSignature, { tournamentId: o.tournamentId })).rejects.toThrow(/isn't set up/);
    expect(await open.run((ctx) => ctx.db.query("uploadGrants").collect())).toHaveLength(0);
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

describe("bulk approve in batches (AUDIT 2026-11 PERF-003)", () => {
  /** n paid registrations, oldest first, straight into the table (no fee, no rate limit). */
  async function seedPaid(t: ReturnType<typeof convexTest>, tournamentId: Id<"tournaments">, n: number, dupOf?: number) {
    await t.run(async (ctx) => {
      for (let i = 0; i < n; i++) {
        const k = dupOf !== undefined && i === n - 1 ? dupOf : i;
        await ctx.db.insert("registrations", {
          tournamentId, name: `Player ${k}`, age: 24, role: ["Batter"], battingBowlingHand: "Right-handed",
          phoneNumber: String(9000000000 + k), consentWhatsApp: false, status: "paid", fee: 0, createdAt: 1_000 + i,
        });
      }
    });
  }

  /** What the review page does: call until nothing remains. */
  async function approveAll(t: ReturnType<typeof convexTest>, tournamentId: Id<"tournaments">) {
    const asOwner = t.withIdentity(OWNER);
    const calls: Array<{ approved: number; failed: unknown[]; remaining: number }> = [];
    let after: number | undefined;
    for (;;) {
      const res = await asOwner.mutation(api.registrations.bulkApprove, { tournamentId, after });
      calls.push(res);
      if (res.remaining === 0) return calls;
      after = res.after;
    }
  }

  test("approves in batches of 50 and reports what is left", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.run((ctx) => ctx.db.patch(tournamentId, { plan: undefined }));
    await seedPaid(t, tournamentId, 120);
    const calls = await approveAll(t, tournamentId);
    expect(calls.map((c) => c.approved)).toEqual([50, 50, 20]);
    expect(calls.map((c) => c.remaining)).toEqual([70, 20, 0]);
    const players = await t.run((ctx) => ctx.db.query("players").collect());
    expect(players).toHaveLength(120);
    expect(new Set(players.map((p) => p.playerNumber)).size).toBe(120);
  });

  test("the plan limit stops at exactly its number; the rest fail and the loop still ends", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t); // free plan: 60 players
    await seedPaid(t, tournamentId, 70);
    const calls = await approveAll(t, tournamentId);
    expect(calls.reduce((n, c) => n + c.approved, 0)).toBe(60);
    expect(calls.reduce((n, c) => n + c.failed.length, 0)).toBe(10);
    expect(await t.run((ctx) => ctx.db.query("players").collect())).toHaveLength(60);
  });

  test("a duplicate within the same batch is reported, not inserted", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await seedPaid(t, tournamentId, 3, 0); // the third repeats the first
    const [res] = await approveAll(t, tournamentId);
    expect(res).toMatchObject({ approved: 2, remaining: 0, failed: [{ name: "Player 0", reason: "Player 0 is already a player" }] });
  });
});

describe("single-use upload grants (AUDIT 2026-11 SEC-003)", () => {
  const CLOUD = "bid11";
  const urlFor = (publicId: string) => `https://res.cloudinary.com/${CLOUD}/image/upload/v1/${publicId}.jpg`;
  beforeEach(() => {
    Object.assign(process.env, { CLOUDINARY_CLOUD_NAME: CLOUD, CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s" });
  });
  afterEach(() => {
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
  });

  test("each signature names its own file, and the signature covers that name", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const a = await t.action(api.registrations.getUploadSignature, { tournamentId });
    const b = await t.action(api.registrations.getUploadSignature, { tournamentId });
    expect(a.public_id).not.toBe(b.public_id);
    const signed = { allowed_formats: a.allowed_formats, folder: a.folder, public_id: a.public_id, timestamp: a.timestamp };
    expect(a.signature).toBe(await cloudinarySignature(signed, "s"));
  });

  test("a photo must come from a grant for this tournament, and each grant works once", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const sig = await t.action(api.registrations.getUploadSignature, { tournamentId });
    const photoUrl = urlFor(`${sig.folder}/${sig.public_id}`);

    // Our cloud and folder, but never granted:
    await expect(
      t.mutation(api.registrations.submit, { tournamentId, ...entry({ photoUrl: urlFor(`${sig.folder}/made-up`) }) }),
    ).rejects.toThrow(/photo/i);
    await t.mutation(api.registrations.submit, { tournamentId, ...entry({ photoUrl }) });
    // The same file again, for someone else:
    await expect(
      t.mutation(api.registrations.submit, { tournamentId, ...entry({ name: "Second Person", phoneNumber: "9123456780", photoUrl }) }),
    ).rejects.toThrow(/photo/i);
  });

  test("another tournament's grant and an expired grant are refused", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const other = await t.run(async (ctx) => {
      const t0 = (await ctx.db.get(tournamentId))!;
      const { _id: _id, _creationTime: _c, ...rest } = t0;
      return await ctx.db.insert("tournaments", { ...rest, name: "Other Cup" });
    });
    const foreign = await t.action(api.registrations.getUploadSignature, { tournamentId: other });
    await expect(
      t.mutation(api.registrations.submit, { tournamentId, ...entry({ photoUrl: urlFor(`${foreign.folder}/${foreign.public_id}`) }) }),
    ).rejects.toThrow(/photo/i);

    const sig = await t.action(api.registrations.getUploadSignature, { tournamentId });
    await t.run(async (ctx) => {
      const grant = await ctx.db.query("uploadGrants").filter((q) => q.eq(q.field("publicId"), `${sig.folder}/${sig.public_id}`)).first();
      await ctx.db.patch(grant!._id, { expiresAt: Date.now() - 1 });
    });
    await expect(
      t.mutation(api.registrations.submit, { tournamentId, ...entry({ photoUrl: urlFor(`${sig.folder}/${sig.public_id}`) }) }),
    ).rejects.toThrow(/photo/i);
  });
});

describe("one registration per device (organiser setting)", () => {
  const DEVICE = "device-aaaaaaaa-1111";
  const OTHER_DEVICE = "device-bbbbbbbb-2222";
  const onePerDevice = (t: ReturnType<typeof convexTest>, tournamentId: Id<"tournaments">, enabled: boolean) =>
    t.withIdentity(OWNER).mutation(api.tournaments.setOneRegistrationPerDevice, { tournamentId, enabled });

  test("off by default: one device can register several people, and the device is recorded", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    expect(await t.query(api.registrations.getPublicInfo, { tournamentId })).toMatchObject({ onePerDevice: false });
    await t.mutation(api.registrations.submit, { tournamentId, ...entry({ deviceId: DEVICE }) });
    await t.mutation(api.registrations.submit, { tournamentId, ...entry({ name: "Second Person", phoneNumber: "9123456780", deviceId: DEVICE }) });
    await t.mutation(api.registrations.submit, { tournamentId, ...entry({ name: "No Device", phoneNumber: "9123456781" }) });
    const rows = await registrations(t);
    expect(rows.map((r) => r.deviceId)).toEqual([DEVICE, DEVICE, undefined]);
  });

  test("on: a second person from the same device is refused and nothing is written; another device is fine", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await onePerDevice(t, tournamentId, true);
    expect(await t.query(api.registrations.getPublicInfo, { tournamentId })).toMatchObject({ onePerDevice: true });
    await t.mutation(api.registrations.submit, { tournamentId, ...entry({ deviceId: DEVICE }) });
    await expect(
      t.mutation(api.registrations.submit, { tournamentId, ...entry({ name: "Second Person", phoneNumber: "9123456780", deviceId: DEVICE }) }),
    ).rejects.toThrow(/already been used to register/);
    expect(await registrations(t)).toHaveLength(1);
    await t.mutation(api.registrations.submit, { tournamentId, ...entry({ name: "Second Person", phoneNumber: "9123456780", deviceId: OTHER_DEVICE }) });
    expect(await registrations(t)).toHaveLength(2);
  });

  test("on: it counts entries made before the switch, but not rejected ones", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const first = await t.mutation(api.registrations.submit, { tournamentId, ...entry({ deviceId: DEVICE }) });
    await onePerDevice(t, tournamentId, true);
    const second = () => t.mutation(api.registrations.submit, { tournamentId, ...entry({ name: "Second Person", phoneNumber: "9123456780", deviceId: DEVICE }) });
    await expect(second()).rejects.toThrow(/already been used to register/);
    await t.withIdentity(OWNER).mutation(api.registrations.reject, { registrationId: first.registrationId as Id<"registrations">, reason: "Wrong person" });
    await expect(second()).resolves.toMatchObject({ success: true });
  });

  test("on: the same person retrying gets their registration back, not the device refusal", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await onePerDevice(t, tournamentId, true);
    const first = await t.mutation(api.registrations.submit, { tournamentId, ...entry({ deviceId: DEVICE }) });
    await expect(t.mutation(api.registrations.submit, { tournamentId, ...entry({ deviceId: DEVICE }) })).resolves.toMatchObject({
      alreadyRegistered: true,
      registrationId: first.registrationId,
    });
    expect(await registrations(t)).toHaveLength(1);
  });

  test("on: a submit without a device id is refused; a malformed id is always refused", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await expect(t.mutation(api.registrations.submit, { tournamentId, ...entry({ deviceId: "bad id!" }) })).rejects.toThrow(/Reload the page/);
    await onePerDevice(t, tournamentId, true);
    await expect(t.mutation(api.registrations.submit, { tournamentId, ...entry() })).rejects.toThrow(/Reload the page/);
    expect(await registrations(t)).toHaveLength(0);
  });

  test("only owners switch it; it's audit-logged, refused once completed, and kept when other settings are saved", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await expect(
      t.withIdentity(OTHER).mutation(api.tournaments.setOneRegistrationPerDevice, { tournamentId, enabled: true }),
    ).rejects.toThrow();
    await onePerDevice(t, tournamentId, true);
    const logs = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(logs.filter((l) => l.action === "set_one_registration_per_device")).toHaveLength(1);

    // The settings modal sends the whole settings object, without this field.
    const tournament = (await t.run((ctx) => ctx.db.get(tournamentId)))!;
    const { oneRegistrationPerDevice: _omitted, ...modalSettings } = tournament.settings;
    await t.withIdentity(OWNER).mutation(api.tournaments.update, { id: tournamentId, settings: { ...modalSettings, maxPlayersPerTeam: 6 } });
    expect((await t.run((ctx) => ctx.db.get(tournamentId)))!.settings).toMatchObject({ maxPlayersPerTeam: 6, oneRegistrationPerDevice: true });
    // ...and the settings audit entry doesn't claim the switch changed.
    const settingsLogs = (await t.run((ctx) => ctx.db.query("auditLogs").collect())).filter((l) => l.action !== "set_one_registration_per_device");
    expect(JSON.stringify(settingsLogs.map((l) => l.newData))).not.toContain("oneRegistrationPerDevice");

    await t.run((ctx) => ctx.db.patch(tournamentId, { status: "completed" }));
    await expect(onePerDevice(t, tournamentId, false)).rejects.toThrow(/completed/);
  });
});

describe("same person, same device, submitting again (a lost answer)", () => {
  const DEVICE = "device-retry-0000-1111";
  const CLOUD = "bid11";
  beforeEach(() => {
    Object.assign(process.env, { CLOUDINARY_CLOUD_NAME: CLOUD, CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s" });
  });
  afterEach(() => {
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
  });
  const notifications = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("notifications").collect());

  test("gets its existing registration back, still awaiting the fee, and nothing new is written", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { registrationFee: 300 });
    const first = await t.mutation(api.registrations.submit, { tournamentId, ...entry({ deviceId: DEVICE }) });
    const again = await t.mutation(api.registrations.submit, { tournamentId, ...entry({ deviceId: DEVICE }) });
    expect(again).toEqual({ success: true, alreadyRegistered: true, registrationId: first.registrationId, needsPayment: true, fee: 300 });
    expect(await registrations(t)).toHaveLength(1);
    expect(await notifications(t)).toHaveLength(1);
  });

  test("a retry carrying the same, already used, photo still finds the registration", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const sig = await t.action(api.registrations.getUploadSignature, { tournamentId });
    const photoUrl = `https://res.cloudinary.com/${CLOUD}/image/upload/v1/${sig.folder}/${sig.public_id}.jpg`;
    const first = await t.mutation(api.registrations.submit, { tournamentId, ...entry({ deviceId: DEVICE, photoUrl }) });
    await expect(t.mutation(api.registrations.submit, { tournamentId, ...entry({ deviceId: DEVICE, photoUrl }) })).resolves.toMatchObject({
      alreadyRegistered: true,
      registrationId: first.registrationId,
      needsPayment: false,
    });
  });

  test("another device, or none, gets the duplicate error and no registration id", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { registrationFee: 300 });
    await t.mutation(api.registrations.submit, { tournamentId, ...entry({ deviceId: DEVICE }) });
    await expect(t.mutation(api.registrations.submit, { tournamentId, ...entry({ deviceId: "someone-elses-device" }) })).rejects.toThrow(
      /already registered/,
    );
    await expect(t.mutation(api.registrations.submit, { tournamentId, ...entry() })).rejects.toThrow(/already registered/);
  });

  test("an entry made without a device id is never handed back", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.mutation(api.registrations.submit, { tournamentId, ...entry() });
    await expect(t.mutation(api.registrations.submit, { tournamentId, ...entry({ deviceId: DEVICE }) })).rejects.toThrow(/already registered/);
  });

  test("a rejected entry is not handed back: the person registers afresh", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const first = await t.mutation(api.registrations.submit, { tournamentId, ...entry({ deviceId: DEVICE }) });
    await t.withIdentity(OWNER).mutation(api.registrations.reject, { registrationId: first.registrationId as Id<"registrations">, reason: "Typo" });
    const again = await t.mutation(api.registrations.submit, { tournamentId, ...entry({ deviceId: DEVICE }) });
    expect(again.registrationId).not.toBe(first.registrationId);
    expect(again).not.toHaveProperty("alreadyRegistered");
  });
});

describe("couple tournaments", () => {
  const partner = (over: Record<string, unknown> = {}) => ({
    phoneNumber: "9123456780",
    age: 22,
    role: ["Bowler"],
    battingBowlingHand: "Left-handed" as const,
    ...over,
  });
  const couple = (over: Record<string, unknown> = {}) => entry({ name: "Ravi & Priya", partner: partner(), ...over });

  test("a couple registers together and is approved as one player with a partner", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { format: "couple" });
    const res = await t.mutation(api.registrations.submit, { tournamentId, ...couple() });
    expect(res).toMatchObject({ success: true });
    const playerId = await t.withIdentity(OWNER).mutation(api.registrations.approve, { registrationId: res.registrationId as Id<"registrations"> });
    const players = await t.run((ctx) => ctx.db.query("players").collect());
    expect(players).toHaveLength(1);
    expect(players[0]).toMatchObject({ _id: playerId, name: "Ravi & Priya", partner: partner() });
    expect(players[0].gender).toBeUndefined();
    expect(players[0]).not.toHaveProperty("ranking");
  });

  test("couple fields are refused in a standard tournament", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    for (const extra of [{ partner: partner() }, { gender: "male" }]) {
      await expect(t.mutation(api.registrations.submit, { tournamentId, ...entry(extra) })).rejects.toThrow(/couple tournaments/);
    }
    expect(await registrations(t)).toHaveLength(0);
  });

  test("a solo entry needs a gender, and has no partner", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { format: "couple" });
    await expect(t.mutation(api.registrations.submit, { tournamentId, ...entry({}) })).rejects.toThrow(/gender/i);
    const res = await t.mutation(api.registrations.submit, { tournamentId, ...entry({ gender: "female" }) });
    const playerId = await t.withIdentity(OWNER).mutation(api.registrations.approve, { registrationId: res.registrationId as Id<"registrations"> });
    const player = await t.run((ctx) => ctx.db.get(playerId));
    expect(player).toMatchObject({ gender: "female" });
    expect(player?.partner).toBeUndefined();
  });

  test("there is no ranking: entries register without one, and one sent is refused", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { format: "couple" });
    expect(await t.mutation(api.registrations.submit, { tournamentId, ...entry({ gender: "male" }) })).toMatchObject({ success: true });
    await expect(t.mutation(api.registrations.submit, { tournamentId, ...couple({ ranking: 8 }) })).rejects.toThrow(/ranking/);
    await expect(
      t.mutation(api.registrations.submit, { tournamentId, ...couple({ phoneNumber: "9000000002", partner: partner({ ranking: 9 }) }) }),
    ).rejects.toThrow(/ranking/);
  });

  test("a couple entry can't also set a gender", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { format: "couple" });
    await expect(t.mutation(api.registrations.submit, { tournamentId, ...couple({ gender: "male" }) })).rejects.toThrow(/gender/i);
  });

  test("the female member's phone, age and jersey number are validated", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { format: "couple" });
    for (const [bad, error] of [
      [{ partner: partner({ phoneNumber: "+91 98765 43210" }) }, /Female.*different phone/],
      [{ partner: partner({ phoneNumber: "" }) }, /Female: Phone number is required/],
      [{ partner: partner({ phoneNumber: "123" }) }, /Female: Phone number must be 10 digits/],
      [{ partner: partner({ age: 2 }) }, /Female: Age/],
      [{ partner: partner({ jerseyNumber: 100 }) }, /Female: Jersey number/],
    ] as const) {
      await expect(t.mutation(api.registrations.submit, { tournamentId, ...couple(bad) })).rejects.toThrow(error);
    }
    expect(await registrations(t)).toHaveLength(0);
    const ok = await t.mutation(api.registrations.submit, { tournamentId, ...couple() });
    expect(ok).toMatchObject({ success: true });
  });

  test("the organiser's required fields apply to the female member too", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { format: "couple" });
    await t.withIdentity(OWNER).mutation(api.registrationForms.save, {
      tournamentId,
      questions: [],
      requiredFields: { tshirtSize: true, jerseyNumber: true, jerseyName: true },
      expectedVersion: 0,
    });
    const male = { tshirtSize: "M", jerseyNumber: 7 };
    await expect(
      t.mutation(api.registrations.submit, { tournamentId, ...couple({ ...male, partner: partner({ jerseyNumber: 8 }) }) }),
    ).rejects.toThrow(/^.*Female: T-shirt size is required/);
    await expect(
      t.mutation(api.registrations.submit, { tournamentId, ...couple({ ...male, partner: partner({ tshirtSize: "S", role: [] }) }) }),
    ).rejects.toThrow(/Female: Choose at least one role/);
    // Couples don't use the name on the jersey, so it isn't asked for.
    const res = await t.mutation(api.registrations.submit, {
      tournamentId,
      ...couple({ ...male, partner: partner({ tshirtSize: "S", jerseyNumber: 8 }) }),
    });
    expect(res).toMatchObject({ success: true });
  });

  test("each member picks exactly one type", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { format: "couple" });
    await expect(
      t.mutation(api.registrations.submit, { tournamentId, ...couple({ partner: partner({ role: ["Bowler", "Batter"] }) }) }),
    ).rejects.toThrow(/Female: Choose one type/);
    await expect(
      t.mutation(api.registrations.submit, { tournamentId, ...couple({ partner: partner({ role: ["Wicket Keeper"] }) }) }),
    ).rejects.toThrow(/Female: Choose one type/);
  });

  test("a removed field is dropped for both members of a couple", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { format: "couple" });
    await t.withIdentity(OWNER).mutation(api.registrationForms.save, {
      tournamentId,
      questions: [],
      hiddenFields: ["age", "tshirtSize"],
      expectedVersion: 0,
    });
    await t.mutation(api.registrations.submit, { tournamentId, ...couple({ tshirtSize: "M", partner: partner({ tshirtSize: "S" }) }) });
    const [reg] = await registrations(t);
    expect(reg).not.toHaveProperty("age");
    expect(reg).not.toHaveProperty("tshirtSize");
    expect(reg.partner).not.toHaveProperty("age");
    expect(reg.partner).not.toHaveProperty("tshirtSize");
    expect(reg.partner).toMatchObject({ role: ["Bowler"] });
  });

  test("couples and solos each pay their own fee", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { format: "couple", registrationFee: 300, coupleRegistrationFee: 500 });
    expect(await t.query(api.registrations.getPublicInfo, { tournamentId })).toMatchObject({ fee: 300, coupleFee: 500 });

    const pair = await t.mutation(api.registrations.submit, { tournamentId, ...couple() });
    expect(pair).toMatchObject({ needsPayment: true, fee: 500 });
    const solo = await t.mutation(api.registrations.submit, {
      tournamentId,
      ...entry({ name: "Smriti", phoneNumber: "9000000001", gender: "female" }),
    });
    expect(solo).toMatchObject({ needsPayment: true, fee: 300 });
    // The couple's order must be for the couple fee.
    const registrationId = pair.registrationId as Id<"registrations">;
    await expect(t.mutation(api.registrations.recordOrder, { registrationId, razorpayOrderId: "o1", amount: 30_000 })).rejects.toThrow(/amount/);
    await t.mutation(api.registrations.recordOrder, { registrationId, razorpayOrderId: "o1", amount: 50_000 });
  });

  test("solo can be free while couples pay", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { format: "couple", registrationFee: 0, coupleRegistrationFee: 400 });
    const solo = await t.mutation(api.registrations.submit, {
      tournamentId,
      ...entry({ name: "Smriti", phoneNumber: "9000000001", gender: "female" }),
    });
    expect(solo).toMatchObject({ needsPayment: false, fee: 0 });
    expect(await t.mutation(api.registrations.submit, { tournamentId, ...couple() })).toMatchObject({ needsPayment: true, fee: 400 });
  });

  test("with no couple fee set, couples pay the solo fee", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { format: "couple", registrationFee: 300 });
    expect(await t.query(api.registrations.getPublicInfo, { tournamentId })).toMatchObject({ fee: 300, coupleFee: 300 });
    expect(await t.mutation(api.registrations.submit, { tournamentId, ...couple() })).toMatchObject({ fee: 300 });
  });

  test("a standard tournament ignores a stored couple fee", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t, { registrationFee: 300, coupleRegistrationFee: 500 });
    expect(await t.query(api.registrations.getPublicInfo, { tournamentId })).toMatchObject({ fee: 300, coupleFee: 300 });
    expect(await t.mutation(api.registrations.submit, { tournamentId, ...entry() })).toMatchObject({ fee: 300 });
  });

  test("the public info says which format the tournament uses", async () => {
    const t = convexTest(schema, modules);
    const standard = await setup(t);
    expect((await t.query(api.registrations.getPublicInfo, { tournamentId: standard.tournamentId }))?.format).toBe("standard");
    const t2 = convexTest(schema, modules);
    const c = await setup(t2, { format: "couple" });
    expect((await t2.query(api.registrations.getPublicInfo, { tournamentId: c.tournamentId }))?.format).toBe("couple");
  });
});
