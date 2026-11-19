// Pure round selection (AUDIT 2026-11 CQ-001): every branch of chooseNext.
import { describe, expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import { allSquadsFull, chooseNext, shuffleInPlace } from "./rounds";

const id = (s: string) => s as Id<"players">;
const p = (name: string, categoryId?: string) => ({ _id: id(name), categoryId });
const first = () => 0; // always pick index 0 / no shuffle movement
const CATS = [
  { id: "marquee", name: "Marquee", basePrice: 100, order: 1, colour: "#000000" },
  { id: "a", name: "A", basePrice: 50, order: 2, colour: "#000000" },
];

describe("main round", () => {
  test("random order picks from all pending players", () => {
    const d = chooseNext({ room: {}, pending: [p("x"), p("y")], unsold: [], random: () => 0.99 });
    expect(d).toEqual({ kind: "present", player: p("y"), roomPatch: { auctionPhase: "main", roundNumber: 1 } });
  });

  test("by_category announces a new set before loading anyone", () => {
    const d = chooseNext({
      room: {},
      presentationOrder: "by_category",
      categories: CATS,
      pending: [p("x", "a"), p("y", "marquee")],
      unsold: [],
    });
    expect(d).toEqual({ kind: "enterSet", setId: "marquee" });
  });

  test("by_category then picks only from the current set", () => {
    const d = chooseNext({
      room: { currentSetId: "marquee" },
      presentationOrder: "by_category",
      categories: CATS,
      pending: [p("x", "a"), p("y", "marquee")],
      unsold: [],
      random: first,
    });
    expect(d).toMatchObject({ kind: "present", player: p("y", "marquee"), roomPatch: { currentSetId: "marquee" } });
  });

  test("uncategorised players come last without an announcement", () => {
    const d = chooseNext({
      room: { currentSetId: "a" },
      presentationOrder: "by_category",
      categories: CATS,
      pending: [p("z")],
      unsold: [],
      random: first,
    });
    expect(d).toMatchObject({ kind: "present", player: p("z"), roomPatch: { currentSetId: "__uncategorised__" } });
  });
});

describe("unsold rounds", () => {
  test("nobody pending or unsold: complete", () => {
    expect(chooseNext({ room: {}, pending: [], unsold: [] })).toEqual({ kind: "complete" });
  });

  test("first crossing into unsold is announced with a queue", () => {
    const d = chooseNext({ room: { auctionPhase: "main" }, pending: [], unsold: [p("u1"), p("u2")], random: first });
    expect(d.kind).toBe("enterUnsoldRound");
    expect(d.kind === "enterUnsoldRound" && [...d.queue].sort()).toEqual(["u1", "u2"]);
  });

  test("mid-round presents the next queued player and skips anyone no longer unsold", () => {
    const d = chooseNext({
      room: { auctionPhase: "unsold", unsoldQueue: [id("gone"), id("u2")], unsoldCursor: 0 },
      pending: [],
      unsold: [p("u2")],
    });
    expect(d).toEqual({ kind: "present", player: p("u2"), roomPatch: { auctionPhase: "unsold", unsoldCursor: 2 } });
  });

  test("a round where nobody left the pool stalls", () => {
    const d = chooseNext({
      room: { auctionPhase: "unsold", unsoldQueue: [id("u1"), id("u2")], unsoldCursor: 2 },
      pending: [],
      unsold: [p("u1"), p("u2")],
    });
    expect(d).toEqual({ kind: "stall" });
  });

  test("a round with progress rolls into the next round immediately", () => {
    const d = chooseNext({
      room: { auctionPhase: "unsold", unsoldQueue: [id("u1"), id("sold")], unsoldCursor: 2, roundNumber: 2 },
      pending: [],
      unsold: [p("u1")],
    });
    expect(d).toEqual({
      kind: "present",
      player: p("u1"),
      roomPatch: { auctionPhase: "unsold", roundNumber: 3, unsoldQueue: [id("u1")], unsoldCursor: 1, unsoldRoundTotal: 1 },
    });
  });
});

describe("helpers", () => {
  test("allSquadsFull needs every team full, and at least one team", () => {
    expect(allSquadsFull([], [], 2)).toBe(false);
    expect(allSquadsFull(["a", "b"], ["a", "a", "b"], 2)).toBe(false);
    expect(allSquadsFull(["a", "b"], ["a", "a", "b", "b", undefined], 2)).toBe(true);
  });

  test("shuffleInPlace keeps every element", () => {
    expect(shuffleInPlace([1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4]);
  });
});
