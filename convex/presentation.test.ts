import { describe, expect, test } from "vitest";
import { nextPresentationSet, UNCATEGORISED_SET } from "./presentation";

const categories = [
  { id: "a", name: "Set A", basePrice: 200_000, order: 2, colour: "#2563eb" },
  { id: "marquee", name: "Marquee", basePrice: 500_000, order: 1, colour: "#f59e0b" },
];
const p = (id: string, categoryId?: string) => ({ _id: id, categoryId });

describe("nextPresentationSet", () => {
  test("lowest-order category with pending players comes first", () => {
    const set = nextPresentationSet([p("1", "a"), p("2", "marquee"), p("3")], categories);
    expect(set?.setId).toBe("marquee");
    expect(set?.players.map((x) => x._id)).toEqual(["2"]);
  });

  test("skips categories with nobody left", () => {
    const set = nextPresentationSet([p("1", "a"), p("3")], categories);
    expect(set?.setId).toBe("a");
  });

  test("uncategorised (or unknown-category) players come last, together", () => {
    const set = nextPresentationSet([p("3"), p("4", "deleted")], categories);
    expect(set?.setId).toBe(UNCATEGORISED_SET);
    expect(set?.category).toBeUndefined();
    expect(set?.players).toHaveLength(2);
  });

  test("null when nobody is pending", () => {
    expect(nextPresentationSet([], categories)).toBeNull();
  });
});
