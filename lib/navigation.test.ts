import { describe, expect, test } from "vitest";
import { safeNextPath } from "./navigation";

describe("safeNextPath", () => {
  test("keeps same-site paths", () => {
    expect(safeNextPath("/tournament/create")).toBe("/tournament/create");
    expect(safeNextPath("/auction/abc?x=1")).toBe("/auction/abc?x=1");
  });

  test.each([null, "", "https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "dashboard"])(
    "falls back to the dashboard for %s",
    (raw) => {
      expect(safeNextPath(raw)).toBe("/dashboard");
    },
  );
});
