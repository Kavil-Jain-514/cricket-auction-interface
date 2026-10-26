import { describe, expect, test } from "vitest";
import { diffFields } from "./jsonDiff";

describe("diffFields", () => {
  test("lists every top-level field with before, after and whether it changed", () => {
    expect(diffFields({ price: 100, team: "A" }, { price: 150, team: "A", reason: "typo" })).toEqual([
      { key: "price", before: "100", after: "150", changed: true },
      { key: "reason", before: undefined, after: '"typo"', changed: true },
      { key: "team", before: '"A"', after: '"A"', changed: false },
    ]);
  });

  test("nested values compare structurally and render as JSON", () => {
    const rows = diffFields({ roles: ["Batter"] }, { roles: ["Batter"] });
    expect(rows).toEqual([{ key: "roles", before: '["Batter"]', after: '["Batter"]', changed: false }]);
  });

  test("missing or non-object sides are treated as empty", () => {
    expect(diffFields(undefined, { a: 1 })).toEqual([{ key: "a", before: undefined, after: "1", changed: true }]);
    expect(diffFields(null, null)).toEqual([]);
  });
});
