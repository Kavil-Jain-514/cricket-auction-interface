import { describe, expect, test } from "vitest";
import { buildTeamPdfPlayers, type PdfSourcePlayer, type PdfSourceTeam } from "./teamPdfPlayers";

const team: PdfSourceTeam = { _id: "teamA" };

const sold: PdfSourcePlayer = {
  _id: "p1",
  name: "Rohit Sharma",
  role: ["Batter"],
  battingBowlingHand: "Right-handed",
  age: 37,
  soldPrice: 250_000,
  teamId: "teamA",
  phoneNumber: "9876543210",
};
const otherTeam: PdfSourcePlayer = { ...sold, _id: "p2", name: "Elsewhere", teamId: "teamB" };

describe("buildTeamPdfPlayers", () => {
  test("only the team's own players, no captain row without a captain", () => {
    const rows = buildTeamPdfPlayers(team, [sold, otherTeam]);
    expect(rows.map((r) => r.name)).toEqual(["Rohit Sharma"]);
    expect(rows[0]).toMatchObject({ role: "Batter", battingBowlingHand: "Right-handed", phoneNumber: "9876543210", isCaptain: false });
  });

  test("captain picked from players (not sold to the team) is added first", () => {
    const captain: PdfSourcePlayer = { _id: "c1", name: "Virat Kohli", role: ["Batter", "Bowler"], battingBowlingHand: "Right-handed", age: 36 };
    const rows = buildTeamPdfPlayers({ ...team, captainPlayerId: "c1" }, [sold, captain]);
    expect(rows[0]).toMatchObject({ name: "Virat Kohli", role: "Batter, Bowler", age: 36, isCaptain: true });
    expect(rows).toHaveLength(2);
  });

  test("captain picked from players who is also on the squad is not duplicated", () => {
    const rows = buildTeamPdfPlayers({ ...team, captainPlayerId: "p1" }, [sold]);
    expect(rows).toHaveLength(1);
    expect(rows[0].isCaptain).toBe(true);
  });

  test("captain entered by hand comes from the team's own captain fields", () => {
    const rows = buildTeamPdfPlayers(
      { ...team, captainName: "MS Dhoni", captainAge: 43, captainRole: "All-Rounder", captainHand: "Left" },
      [sold],
    );
    expect(rows[0]).toEqual({ name: "MS Dhoni", age: 43, role: "All-Rounder", battingBowlingHand: "Left-handed", isCaptain: true });
    expect(rows).toHaveLength(2);
  });

  test("hand-entered captain with only a name leaves role and hand blank", () => {
    const rows = buildTeamPdfPlayers({ ...team, captainName: "  MS Dhoni " }, []);
    expect(rows).toEqual([{ name: "MS Dhoni", age: undefined, role: "", battingBowlingHand: undefined, isCaptain: true }]);
  });

  test("a blank hand-entered name adds no captain row", () => {
    expect(buildTeamPdfPlayers({ ...team, captainName: "   " }, [])).toEqual([]);
  });
});

describe("buildTeamPdfPlayers — couple tournaments", () => {
  const partner = { phoneNumber: "9123456780", age: 30, role: ["Bowler"], battingBowlingHand: "Left-handed" as const, jerseyNumber: 9, tshirtSize: "M" as const };
  const couple: PdfSourcePlayer = { ...sold, _id: "c", name: "Rohit & Ritika", partner };
  const solo: PdfSourcePlayer = { ...sold, _id: "s", name: "Smriti", gender: "female" };

  test("rows carry gender and the female member", () => {
    const rows = buildTeamPdfPlayers(team, [couple, solo], { couple: true });
    expect(rows[0]).toMatchObject({
      name: "Rohit & Ritika",
      gender: "Male",
      partner: { age: 30, phoneNumber: "9123456780", jerseyNumber: 9, tshirtSize: "M", battingBowlingHand: "Left-handed", gender: "Female" },
    });
    expect(rows[0]).not.toHaveProperty("ranking");
    expect(rows[0].partner).not.toHaveProperty("ranking");
    expect(rows[1]).toMatchObject({ gender: "Female" });
    expect(rows[1]).not.toHaveProperty("partner");
  });

  test("standard tournaments get exactly the old rows", () => {
    const rows = buildTeamPdfPlayers(team, [couple]);
    expect(rows).toStrictEqual([
      {
        name: "Rohit & Ritika",
        age: 37,
        role: "Batter",
        soldPrice: 250_000,
        jerseyNumber: undefined,
        jerseyName: undefined,
        battingBowlingHand: "Right-handed",
        phoneNumber: "9876543210",
        tshirtSize: undefined,
        isCaptain: false,
      },
    ]);
  });
});
