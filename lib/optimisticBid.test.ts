import { describe, expect, test } from "vitest";
import { applyOptimisticBid, newRequestId } from "./optimisticBid";

const live = {
  auctionRoom: { _id: "r" },
  currentBidAmount: 100_000,
  currentBidTeamId: "a",
  currentBidTeam: { _id: "a", name: "A" },
  recentBids: Array.from({ length: 10 }, (_, i) => ({ _id: `b${i}`, teamId: "a", amount: 100_000 - i, timestamp: i })),
  totalBidsCount: 12,
  serverTime: 5,
};

describe("applyOptimisticBid", () => {
  test("puts the bid on top and bumps the count, keeping other fields", () => {
    const next = applyOptimisticBid(live, { teamId: "b", amount: 125_000 }, { _id: "b", name: "B" }, 99);
    expect(next).toMatchObject({ currentBidAmount: 125_000, currentBidTeamId: "b", currentBidTeam: { name: "B" }, totalBidsCount: 13, serverTime: 5 });
    expect(next.recentBids[0]).toEqual({ _id: "optimistic:99", teamId: "b", amount: 125_000, timestamp: 99 });
    expect(next.recentBids).toHaveLength(10);
  });

  test("does not mutate the cached payload", () => {
    applyOptimisticBid(live, { teamId: "b", amount: 125_000 }, null, 1);
    expect(live.totalBidsCount).toBe(12);
    expect(live.recentBids[0]._id).toBe("b0");
  });

  test("keeps the previous team object when the roster doesn't have the new one", () => {
    expect(applyOptimisticBid(live, { teamId: "z", amount: 1 }, null, 1).currentBidTeam).toEqual({ _id: "a", name: "A" });
  });
});

describe("newRequestId", () => {
  test("unique per call", () => {
    expect(newRequestId()).not.toBe(newRequestId());
  });
});
