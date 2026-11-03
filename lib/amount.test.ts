import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { editAmount, formatAmount, MAX_AMOUNT_DIGITS, parseAmount } from "./amount";

describe("formatAmount (Indian grouping)", () => {
  test.each([
    [0, "0"],
    [5, "5"],
    [999, "999"],
    [1000, "1,000"],
    [99999, "99,999"],
    [100000, "1,00,000"],
    [1234567, "12,34,567"],
    [100000000, "10,00,00,000"],
    [-150000, "-1,50,000"],
  ])("%d -> %s", (n, text) => {
    expect(formatAmount(n)).toBe(text);
  });

  test("never shows fractions (amounts are whole rupees)", () => {
    expect(formatAmount(1500.75)).toBe("1,500");
  });
});

describe("parseAmount", () => {
  test.each([
    ["", undefined],
    ["   ", undefined],
    ["12,34,567", 1234567],
    ["₹ 1,00,000", 100000],
    ["1 00 000", 100000],
    ["0005", 5],
    ["abc", undefined],
    ["12abc34", 1234],
    ["1.5", 15], // no decimals: the point is ignored like any other non-digit
    ["-500", 500], // amounts are never negative
  ])("%j -> %s", (text, n) => {
    expect(parseAmount(text)).toBe(n);
  });

  test("caps at a safe integer length", () => {
    expect(parseAmount("9".repeat(30))).toBe(Number("9".repeat(MAX_AMOUNT_DIGITS)));
  });

  test("round-trips every whole amount", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: Number("9".repeat(MAX_AMOUNT_DIGITS)) }), (n) => {
        expect(parseAmount(formatAmount(n))).toBe(n);
      }),
    );
  });
});

describe("editAmount (what the input shows after a keystroke)", () => {
  // `|` marks the caret.
  const run = (prev: string, raw: string, key?: "Backspace" | "Delete") => {
    const caret = raw.indexOf("|");
    const r = editAmount(prev, raw.replace("|", ""), caret, key);
    return `${r.text.slice(0, r.caret)}|${r.text.slice(r.caret)}`;
  };

  test("typing adds separators and keeps the caret after the typed digit", () => {
    expect(run("", "1|")).toBe("1|");
    expect(run("1,234", "1,2345|")).toBe("12,345|");
    expect(run("1,00,000", "1,005|,000")).toBe("10,05|,000");
  });

  test("typing in the middle keeps the caret in place", () => {
    // 100000 -> type 7 after the first 1 -> 1700000
    expect(run("1,00,000", "17|,00,000")).toBe("17|,00,000");
  });

  test("pasting formatted or messy text", () => {
    expect(run("", "₹12,34,567|")).toBe("12,34,567|");
    expect(run("", "1 2 3 4|")).toBe("1,234|");
  });

  test("letters are dropped and the caret does not jump", () => {
    expect(run("1,234", "1,23a|4")).toBe("1,23|4");
  });

  test("backspace over a separator deletes the digit before it", () => {
    // "1,234" with the caret after the comma; backspace removes the comma.
    expect(run("1,234", "1|234", "Backspace")).toBe("|234");
  });

  test("delete over a separator deletes the digit after it", () => {
    expect(run("1,234", "1|234", "Delete")).toBe("1|34");
  });

  test("clearing gives empty text", () => {
    expect(run("5", "|")).toBe("|");
  });
});
