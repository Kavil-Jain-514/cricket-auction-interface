import { describe, expect, test } from "vitest";
import { buildResultsSheets, type ResultsExportData } from "./resultsWorkbook";

const T0 = Date.UTC(2026, 9, 26, 12, 30); // 18:00 IST

const data: ResultsExportData = {
  tournament: { name: "Results Cup", basePurse: 1_000_000 },
  categories: [{ id: "marquee", name: "Marquee", basePrice: 300_000, order: 0, colour: "#f59e0b" }],
  teams: [
    { _id: "tA", name: "Team A", purseSpent: 550_000, purseRemaining: 450_000, captainPlayerId: "cap" },
    { _id: "tB", name: "Team B", purseSpent: 200_000, purseRemaining: 800_000 },
  ],
  players: [
    { _id: "cap", name: "Captain A", role: ["Batter"], auctionStatus: "pending", basePrice: 100_000 },
    { _id: "v", name: "Virat", role: ["Batter"], categoryId: "marquee", auctionStatus: "sold", teamId: "tA", soldPrice: 400_000, basePrice: 300_000 },
    { _id: "r", name: "Rohit", role: "Batter", auctionStatus: "sold", teamId: "tA", soldPrice: 150_000, basePrice: 100_000 },
    { _id: "d", name: "Dhoni", role: ["Wicket Keeper"], auctionStatus: "sold", teamId: "tB", soldPrice: 200_000, basePrice: 100_000 },
    { _id: "u", name: "Unsold Joe", role: ["Bowler"], auctionStatus: "unsold", basePrice: 150_000 },
    { _id: "g", name: "Gone Jim", role: ["Bowler"], auctionStatus: "final_unsold", basePrice: 100_000 },
  ],
  sales: [
    { playerId: "v", teamId: "tA", amount: 400_000, timestamp: T0, bidCount: 6 },
    { playerId: "r", teamId: "tA", amount: 125_000, timestamp: T0 + 60_000 },
  ],
  contacts: null,
};

describe("buildResultsSheets", () => {
  test("sheet names and row counts (header + one row per record)", () => {
    const sheets = buildResultsSheets(data);
    expect(Object.keys(sheets)).toEqual(["Squads", "Team summary", "Unsold", "Sale log"]);
    expect(sheets["Squads"]).toHaveLength(1 + 4); // 3 buys + 1 captain
    expect(sheets["Team summary"]).toHaveLength(1 + 2);
    expect(sheets["Unsold"]).toHaveLength(1 + 2);
    expect(sheets["Sale log"]).toHaveLength(1 + 3);
  });

  test("squads: captain flagged and free, category named", () => {
    const squads = buildResultsSheets(data)["Squads"];
    expect(squads[0]).toEqual(["Team", "Player", "Role", "Category", "Price (₹)", "Captain"]);
    expect(squads).toContainEqual(["Team A", "Captain A", "Batter", "", 0, "Yes"]);
    expect(squads).toContainEqual(["Team A", "Virat", "Batter", "Marquee", 400_000, ""]);
  });

  test("team summary: players exclude the captain; average and top buy", () => {
    const summary = buildResultsSheets(data)["Team summary"];
    expect(summary[1]).toEqual(["Team A", 1_000_000, 550_000, 450_000, 2, 275_000, "Virat (₹4.00L)"]);
    expect(summary[2]).toEqual(["Team B", 1_000_000, 200_000, 800_000, 1, 200_000, "Dhoni (₹2.00L)"]);
  });

  test("sale log: final truth, event timing, and notes for changed or event-less sales", () => {
    const log = buildResultsSheets(data)["Sale log"];
    expect(log[0]).toEqual(["Order", "Player", "Team", "Price (₹)", "Time (IST)", "Bids", "Note"]);
    expect(log[1]).toEqual([1, "Virat", "Team A", 400_000, "26 Oct 2026, 18:00", 6, ""]);
    expect(log[2]).toEqual([2, "Rohit", "Team A", 150_000, "26 Oct 2026, 18:01", "", "Changed after the sale (was Team A at ₹1.25L)"]);
    expect(log[3]).toEqual(["", "Dhoni", "Team B", 200_000, "", "", "Assigned by an admin"]);
  });

  test("contacts sheet only when contacts are present", () => {
    const withContacts = buildResultsSheets({
      ...data,
      contacts: [{ name: "Virat", phoneNumber: "9876543210", teamName: "Team A", auctionStatus: "sold" }],
    });
    expect(Object.keys(withContacts)).toContain("Contacts");
    expect(withContacts["Contacts"]).toHaveLength(2);
  });
});
