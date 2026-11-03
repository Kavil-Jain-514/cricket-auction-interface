/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { FORM_LIMITS, validateAnswers, validateFormQuestions, type Question } from "./registrationForm";

// Phase 6: organiser-built registration questions. Fixtures follow
// auctions.test.ts (see there for why _generated stays in the glob).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.{ts,js}"]);

const OWNER = { email: "owner@test.com", subject: "owner|1" };
const AUCTIONEER = { email: "auctioneer@test.com", subject: "auctioneer|1" };
const OTHER_ORG = { email: "other@test.com", subject: "other|1" };

const PHOTO = "https://res.cloudinary.com/demo/image/upload/v1/cricket-auction/registrations/abc.jpg";

const q = (over: Partial<Question> & Pick<Question, "id" | "type">): Question => ({
  label: `Question ${over.id}`,
  required: false,
  ...over,
});

const QUESTIONS: Question[] = [
  q({ id: "q_club", type: "short_text", label: "Club", required: true }),
  q({ id: "q_bio", type: "long_text" }),
  q({ id: "q_runs", type: "number" }),
  q({ id: "q_bid", type: "amount" }),
  q({ id: "q_city", type: "dropdown", options: ["Pune", "Mumbai"] }),
  q({ id: "q_bat", type: "multiple_choice", options: ["Opener", "Middle"] }),
  q({ id: "q_days", type: "checkboxes", options: ["Sat", "Sun"] }),
  q({ id: "q_dob", type: "date" }),
  q({ id: "q_alt", type: "phone" }),
  q({ id: "q_mail", type: "email" }),
  q({ id: "q_id", type: "file" }),
];

describe("validateFormQuestions", () => {
  test("accepts every question type", () => {
    expect(validateFormQuestions(QUESTIONS)).toBeNull();
  });

  test.each<[string, Question[], RegExp]>([
    ["duplicate ids", [q({ id: "q_a", type: "short_text" }), q({ id: "q_a", type: "number" })], /used twice/],
    ["a bad id", [q({ id: "Q A", type: "short_text" })], /id/],
    ["an empty label", [q({ id: "q_a", type: "short_text", label: "  " })], /needs a question/],
    ["a long label", [q({ id: "q_a", type: "short_text", label: "x".repeat(FORM_LIMITS.labelMax + 1) })], /characters/],
    ["a choice without options", [q({ id: "q_a", type: "dropdown", options: [] })], /at least one option/],
    ["duplicate options", [q({ id: "q_a", type: "checkboxes", options: ["A", "a"] })], /twice/],
    ["too many options", [q({ id: "q_a", type: "dropdown", options: Array.from({ length: FORM_LIMITS.maxOptions + 1 }, (_, i) => `o${i}`) })], /options/],
    ["options on a text question", [q({ id: "q_a", type: "short_text", options: ["A"] })], /options/],
    [
      "too many questions",
      Array.from({ length: FORM_LIMITS.maxQuestions + 1 }, (_, i) => q({ id: `q_${i}x`, type: "short_text" })),
      /at most/,
    ],
  ])("rejects %s", (_label, questions, error) => {
    expect(validateFormQuestions(questions)).toMatch(error);
  });

  test("archived questions don't count towards the limit", () => {
    const many = Array.from({ length: FORM_LIMITS.maxQuestions }, (_, i) => q({ id: `q_${i}x`, type: "short_text" }));
    expect(validateFormQuestions([...many, q({ id: "q_old", type: "short_text", archived: true })])).toBeNull();
  });
});

describe("validateAnswers", () => {
  const ok = [
    { questionId: "q_club", value: "  Deccan Gym  " },
    { questionId: "q_bio", value: "Left-arm spin" },
    { questionId: "q_runs", value: 512 },
    { questionId: "q_bid", value: 150000 },
    { questionId: "q_city", value: "Pune" },
    { questionId: "q_bat", value: "Opener" },
    { questionId: "q_days", value: ["Sun", "Sat"] },
    { questionId: "q_dob", value: "2001-02-28" },
    { questionId: "q_alt", value: "+91 98765-43210" },
    { questionId: "q_mail", value: "Ravi@Example.com" },
    { questionId: "q_id", value: PHOTO },
  ];

  test("cleans valid answers: trims, normalises phone and email, orders choices", () => {
    const { errors, cleaned } = validateAnswers(QUESTIONS, ok);
    expect(errors).toEqual([]);
    const byId = Object.fromEntries(cleaned.map((a) => [a.questionId, a.value]));
    expect(byId.q_club).toBe("Deccan Gym");
    expect(byId.q_alt).toBe("9876543210");
    expect(byId.q_mail).toBe("ravi@example.com");
    expect(byId.q_days).toEqual(["Sat", "Sun"]);
  });

  test("empty answers are dropped; a required one is an error", () => {
    const { errors, cleaned } = validateAnswers(QUESTIONS, [{ questionId: "q_club", value: "   " }, { questionId: "q_days", value: [] }]);
    expect(errors).toEqual([{ questionId: "q_club", message: "Club is required" }]);
    expect(cleaned).toEqual([]);
  });

  test.each<[string, string, unknown]>([
    ["text too long", "q_club", "x".repeat(FORM_LIMITS.shortTextMax + 1)],
    ["text as a number", "q_club", 5],
    ["NaN", "q_runs", Number.NaN],
    ["fractional rupees", "q_bid", 10.5],
    ["negative rupees", "q_bid", -1],
    ["an unknown option", "q_city", "Delhi"],
    ["an unknown checkbox", "q_days", ["Sat", "Mon"]],
    ["an impossible date", "q_dob", "2001-02-30"],
    ["a malformed phone", "q_alt", "12345"],
    ["a malformed email", "q_mail", "not-an-email"],
    ["a file from elsewhere", "q_id", "https://evil.example/x.jpg"],
    ["a file in another folder", "q_id", "https://res.cloudinary.com/demo/image/upload/v1/other/x.jpg"],
  ])("rejects %s", (_label, questionId, value) => {
    const club = { questionId: "q_club", value: "Club" };
    const answers = questionId === "q_club" ? [{ questionId, value }] : [club, { questionId, value }];
    const { errors } = validateAnswers(QUESTIONS, answers as never);
    expect(errors.map((e) => e.questionId)).toContain(questionId);
  });

  test("answers to unknown, archived or repeated questions are rejected", () => {
    const withArchived = [...QUESTIONS, q({ id: "q_gone", type: "short_text", archived: true })];
    const { errors } = validateAnswers(withArchived, [
      { questionId: "q_club", value: "A" },
      { questionId: "q_club", value: "B" },
      { questionId: "q_nope", value: "x" },
      { questionId: "q_gone", value: "x" },
    ]);
    expect(errors.map((e) => e.questionId).sort()).toEqual(["q_club", "q_gone", "q_nope"]);
  });
});

describe("registrationForms (server)", () => {
  const ENV = "REGISTRATION_CUSTOM_QUESTIONS";
  afterEach(() => {
    delete process.env[ENV];
  });

  async function setup(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const owner = await ctx.db.insert("users", { email: OWNER.email, createdAt: now });
      const auctioneer = await ctx.db.insert("users", { email: AUCTIONEER.email, createdAt: now });
      const other = await ctx.db.insert("users", { email: OTHER_ORG.email, createdAt: now });
      const tournamentId = await ctx.db.insert("tournaments", {
        name: "Open Cup",
        createdBy: owner,
        status: "setup",
        settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5, registrationOpen: true },
        createdAt: now,
        updatedAt: now,
      });
      const otherTournament = await ctx.db.insert("tournaments", {
        name: "Other Cup",
        createdBy: other,
        status: "setup",
        settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 5 },
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("tournamentStaff", { tournamentId, userId: owner, role: "owner", createdAt: now });
      await ctx.db.insert("tournamentStaff", { tournamentId, userId: auctioneer, role: "auctioneer", createdAt: now });
      await ctx.db.insert("tournamentStaff", { tournamentId: otherTournament, userId: other, role: "owner", createdAt: now });
      return { tournamentId };
    });
  }

  const entry = (tournamentId: string, over: Record<string, unknown> = {}) => ({
    tournamentId: tournamentId as never,
    name: "Ravi Kumar",
    age: 24,
    role: ["Bowler"],
    battingBowlingHand: "Right-handed" as const,
    phoneNumber: "9876543210",
    consentWhatsApp: true,
    website: "",
    ...over,
  });

  const CLUB = q({ id: "q_club", type: "short_text", label: "Club", required: true });
  const CITY = q({ id: "q_city", type: "dropdown", label: "City", options: ["Pune", "Mumbai"] });

  test("only the tournament's owner saves; each change is a new version", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    for (const who of [AUCTIONEER, OTHER_ORG]) {
      await expect(
        t.withIdentity(who).mutation(api.registrationForms.save, { tournamentId, questions: [CLUB], expectedVersion: 0 }),
      ).rejects.toThrow(/access to this tournament/);
    }
    const asOwner = t.withIdentity(OWNER);
    expect(await asOwner.mutation(api.registrationForms.save, { tournamentId, questions: [CLUB], expectedVersion: 0 })).toEqual({ version: 1 });
    // Unchanged: no new version.
    expect(await asOwner.mutation(api.registrationForms.save, { tournamentId, questions: [CLUB], expectedVersion: 1 })).toEqual({ version: 1 });
    // Someone saved since this editor loaded: refused, nothing lost.
    await expect(
      asOwner.mutation(api.registrationForms.save, { tournamentId, questions: [CITY], expectedVersion: 0 }),
    ).rejects.toThrow(/changed the form/);
    expect(await asOwner.mutation(api.registrationForms.save, { tournamentId, questions: [CLUB, CITY], expectedVersion: 1 })).toEqual({ version: 2 });
    const audit = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(audit.filter((a) => a.action === "save_registration_form")).toHaveLength(2);
  });

  test("the public form shows active questions; submit validates and stores answers with the version", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.withIdentity(OWNER).mutation(api.registrationForms.save, { tournamentId, questions: [CLUB, CITY], expectedVersion: 0 });

    const info = await t.query(api.registrations.getPublicInfo, { tournamentId });
    expect(info?.form).toEqual({ version: 1, questions: [CLUB, CITY] });

    await expect(t.mutation(api.registrations.submit, entry(tournamentId))).rejects.toThrow(/Club is required/);
    await expect(
      t.mutation(api.registrations.submit, entry(tournamentId, { answers: { formVersion: 1, values: [{ questionId: "q_club", value: "<b>Gym</b>" }, { questionId: "q_city", value: "Delhi" }] } })),
    ).rejects.toThrow(/City/);
    await t.mutation(
      api.registrations.submit,
      entry(tournamentId, { answers: { formVersion: 1, values: [{ questionId: "q_club", value: " <b>Gym</b> " }] } }),
    );
    const [row] = await t.withIdentity(OWNER).query(api.registrations.list, { tournamentId });
    // Stored as plain text (React escapes it on display), trimmed.
    expect(row.answers).toEqual({ formVersion: 1, values: [{ questionId: "q_club", value: "<b>Gym</b>" }] });
  });

  test("a submit against an older version is refused with a reload message", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.registrationForms.save, { tournamentId, questions: [CLUB], expectedVersion: 0 });
    await asOwner.mutation(api.registrationForms.save, { tournamentId, questions: [CLUB, CITY], expectedVersion: 1 });
    await expect(
      t.mutation(api.registrations.submit, entry(tournamentId, { answers: { formVersion: 1, values: [{ questionId: "q_club", value: "Gym" }] } })),
    ).rejects.toThrow(/updated.*reload/i);
  });

  test("an answered question can be archived but not deleted or retyped; old answers keep their labels", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.registrationForms.save, { tournamentId, questions: [CLUB, CITY], expectedVersion: 0 });
    await t.mutation(api.registrations.submit, entry(tournamentId, { answers: { formVersion: 1, values: [{ questionId: "q_club", value: "Gym" }] } }));

    const form = await asOwner.query(api.registrationForms.get, { tournamentId });
    expect(form.answerCounts).toEqual({ q_club: 1 });

    await expect(
      asOwner.mutation(api.registrationForms.save, { tournamentId, questions: [CITY], expectedVersion: 1 }),
    ).rejects.toThrow(/Club.*has answers.*archive/);
    await expect(
      asOwner.mutation(api.registrationForms.save, { tournamentId, questions: [{ ...CLUB, type: "number" }, CITY], expectedVersion: 1 }),
    ).rejects.toThrow(/Club.*type/);
    // Never-answered questions delete freely.
    await asOwner.mutation(api.registrationForms.save, { tournamentId, questions: [{ ...CLUB, archived: true, label: "Club (old)" }], expectedVersion: 1 });

    expect((await t.query(api.registrations.getPublicInfo, { tournamentId }))?.form).toEqual({ version: 2, questions: [] });
    const labels = (await asOwner.query(api.registrationForms.get, { tournamentId })).labels;
    expect(labels).toMatchObject({ q_club: { label: "Club (old)", type: "short_text", archived: true }, q_city: { label: "City" } });
  });

  test("answersForPlayer: the approved player's answers with labels, for the owner only", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    const asOwner = t.withIdentity(OWNER);
    await asOwner.mutation(api.registrationForms.save, { tournamentId, questions: [CLUB, CITY], expectedVersion: 0 });
    await t.mutation(
      api.registrations.submit,
      entry(tournamentId, { answers: { formVersion: 1, values: [{ questionId: "q_club", value: "Gym" }, { questionId: "q_city", value: "Pune" }] } }),
    );
    const [registration] = await asOwner.query(api.registrations.list, { tournamentId });
    const playerId = await asOwner.mutation(api.registrations.approve, { registrationId: registration._id });

    expect(await asOwner.query(api.registrationForms.answersForPlayer, { playerId })).toEqual([
      { questionId: "q_club", label: "Club", type: "short_text", archived: false, value: "Gym" },
      { questionId: "q_city", label: "City", type: "dropdown", archived: false, value: "Pune" },
    ]);
    expect(await t.withIdentity(AUCTIONEER).query(api.registrationForms.answersForPlayer, { playerId })).toBeNull();
    expect(await t.withIdentity(OTHER_ORG).query(api.registrationForms.answersForPlayer, { playerId })).toBeNull();
    expect(await t.query(api.registrationForms.answersForPlayer, { playerId })).toBeNull();
  });

  test("with the kill switch off, the form shows and requires no custom questions", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    await t.withIdentity(OWNER).mutation(api.registrationForms.save, { tournamentId, questions: [CLUB], expectedVersion: 0 });
    process.env[ENV] = "off";
    expect((await t.query(api.registrations.getPublicInfo, { tournamentId }))?.form).toBeNull();
    await t.mutation(api.registrations.submit, entry(tournamentId));
    const [row] = await t.withIdentity(OWNER).query(api.registrations.list, { tournamentId });
    expect(row.answers).toBeUndefined();
  });

  test("tournaments without a custom form behave exactly as before", async () => {
    const t = convexTest(schema, modules);
    const { tournamentId } = await setup(t);
    expect((await t.query(api.registrations.getPublicInfo, { tournamentId }))?.form).toBeNull();
    await t.mutation(api.registrations.submit, entry(tournamentId));
    await expect(
      t.mutation(api.registrations.submit, entry(tournamentId, { name: "Second", phoneNumber: "9876543211", answers: { formVersion: 1, values: [] } })),
    ).rejects.toThrow(/updated.*reload/i);
  });
});
