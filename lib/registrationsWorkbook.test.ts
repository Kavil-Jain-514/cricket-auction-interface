import { describe, expect, test } from "vitest";
import { buildRegistrationRows, formatAnswer, sortByRegistered, type QuestionLabels } from "./registrationsWorkbook";

const LABELS: QuestionLabels = {
  q_club: { label: "Club", type: "short_text", archived: false },
  q_bid: { label: "Expected bid", type: "amount", archived: false },
  q_days: { label: "Days", type: "checkboxes", archived: false },
  q_old: { label: "Old question", type: "short_text", archived: true },
  q_never: { label: "Dropped unanswered", type: "short_text", archived: true },
};

const base = {
  phoneNumber: "9876543210",
  age: 24,
  role: ["Bowler"],
  battingBowlingHand: "Right-handed",
  status: "paid",
  fee: 250,
  createdAt: Date.UTC(2026, 10, 3),
};

describe("formatAnswer", () => {
  test("amounts, choices and text", () => {
    expect(formatAnswer(150000, "amount")).toBe("₹1,50,000");
    expect(formatAnswer(42, "number")).toBe("42");
    expect(formatAnswer(["Sat", "Sun"], "checkboxes")).toBe("Sat, Sun");
    expect(formatAnswer("<b>x</b>", "short_text")).toBe("<b>x</b>"); // React escapes on display
  });
});

describe("buildRegistrationRows", () => {
  test("a column per question, archived answered ones last, unanswered archived ones dropped", () => {
    const rows = buildRegistrationRows(
      [
        { ...base, name: "Ravi", answers: { values: [{ questionId: "q_club", value: "Gym" }, { questionId: "q_bid", value: 150000 }, { questionId: "q_old", value: "kept" }] } },
        { ...base, name: "Sam" },
      ],
      LABELS,
    );
    expect(rows[0]).toEqual([
      "Name", "Mobile", "Age", "Role", "Hand", "Status", "Fee (₹)", "Registered (IST)",
      "Club", "Expected bid", "Days", "Old question (archived)",
    ]);
    // Midnight UTC is 05:30 in India.
    expect(rows[1].slice(7)).toEqual(["03 Nov 2026, 05:30", "Gym", 150000, "", "kept"]);
    expect(rows[2].slice(8)).toEqual(["", "", "", ""]);
  });
});

describe("sortByRegistered", () => {
  const rows = [
    { name: "B", createdAt: 2 },
    { name: "C", createdAt: 3 },
    { name: "A", createdAt: 1 },
  ];
  test("newest or oldest first, without changing the input", () => {
    expect(sortByRegistered(rows, "newest").map((r) => r.name)).toEqual(["C", "B", "A"]);
    expect(sortByRegistered(rows, "oldest").map((r) => r.name)).toEqual(["A", "B", "C"]);
    expect(rows.map((r) => r.name)).toEqual(["B", "C", "A"]);
  });
});

describe("buildRegistrationRows — couple tournaments", () => {
  const partner = { phoneNumber: "9123456780", age: 22, role: ["Bowler"], battingBowlingHand: "Left-handed" as const, jerseyNumber: 8, tshirtSize: "S" as const };
  const couple = { ...base, name: "Ravi & Priya", role: ["Batter"], partner };
  const solo = { ...base, name: "Meera", gender: "female" as const };

  test("adds the entry and female columns after Hand", () => {
    const rows = buildRegistrationRows([couple, solo], {}, { couple: true });
    expect(rows[0]).toEqual([
      "Name", "Mobile", "Age", "Role", "Hand",
      "Entry", "Female mobile", "Female age", "Female type", "Female hand", "Female jersey no.", "Female jersey size",
      "Status", "Fee (₹)", "Registered (IST)",
    ]);
    expect(rows[1].slice(0, 13)).toEqual([
      "Ravi & Priya", "9876543210", 24, "Batter", "Right-handed",
      "Couple", "9123456780", 22, "Bowl", "Left-handed", 8, "S", "paid",
    ]);
    expect(rows[2].slice(5, 13)).toEqual(["Female", "", "", "", "", "", "", "paid"]);
  });

  test("standard sheets are unchanged, whatever fields the rows carry", () => {
    const plain = [{ ...base, name: "Ravi" }];
    expect(buildRegistrationRows([{ ...base, name: "Ravi", partner }], LABELS)).toEqual(buildRegistrationRows(plain, LABELS));
    expect(buildRegistrationRows(plain, LABELS, { couple: false })).toEqual(buildRegistrationRows(plain, LABELS));
    expect(buildRegistrationRows(plain, LABELS)[0]).toHaveLength(11);
  });
});
