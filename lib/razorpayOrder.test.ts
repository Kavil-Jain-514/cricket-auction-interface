import { describe, expect, test } from "vitest";
import { buildOrderRequest } from "./razorpayOrder";

describe("buildOrderRequest", () => {
  test("upgrade amount in paise, with the tournament and tier in the notes", () => {
    const req = buildOrderRequest("js78y6scgt9yv6y5fc431hsdwh8a371q", "free", "club");
    expect(req).toMatchObject({ amount: 99_900, currency: "INR", notes: { tournamentId: "js78y6scgt9yv6y5fc431hsdwh8a371q", tier: "club" } });
    expect(req!.receipt.length).toBeLessThanOrEqual(40);
  });

  test("charges only the difference on a later upgrade", () => {
    expect(buildOrderRequest("t", "club", "pro")?.amount).toBe(600_000);
  });

  test("null for a same or lower tier", () => {
    expect(buildOrderRequest("t", "league", "club")).toBeNull();
    expect(buildOrderRequest("t", "pro", "pro")).toBeNull();
  });
});
