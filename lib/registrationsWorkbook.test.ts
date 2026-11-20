import { describe, expect, test } from "vitest";
import { buildRegistrationRows, formatAnswer, type QuestionLabels } from "./registrationsWorkbook";

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
      "Name", "Mobile", "Age", "Role", "Hand", "Status", "Fee (₹)", "Registered",
      "Club", "Expected bid", "Days", "Old question (archived)",
    ]);
    expect(rows[1].slice(7)).toEqual(["2026-11-03", "Gym", 150000, "", "kept"]);
    expect(rows[2].slice(8)).toEqual(["", "", "", ""]);
  });
});
