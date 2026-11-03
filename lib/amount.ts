// lib/amount.ts - Rupee amounts as people type and read them: Indian digit
// grouping (12,34,567), whole rupees only. Forms keep and send plain numbers;
// these only change what is shown. ₹-prefixed display is formatRupees
// (convex/bidRules.ts), which groups the same way.

/** 15 digits always fit a safe integer (MAX_SAFE_INTEGER has 16). */
export const MAX_AMOUNT_DIGITS = 15;

/** "1234567" -> "12,34,567": last three digits, then pairs. */
function groupDigits(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+$)/g, ",")},${tail}`;
}

/** 1234567 -> "12,34,567". Fractions are dropped: amounts are whole rupees. */
export function formatAmount(amount: number): string {
  const whole = Math.trunc(amount);
  const grouped = groupDigits(String(Math.abs(whole)));
  return whole < 0 ? `-${grouped}` : grouped;
}

function digitsOf(text: string): string {
  return text.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, MAX_AMOUNT_DIGITS);
}

/**
 * What someone typed or pasted, as a number: every non-digit (commas, spaces,
 * ₹, letters, a minus or a decimal point) is ignored. Empty -> undefined.
 */
export function parseAmount(text: string): number | undefined {
  const digits = digitsOf(text);
  return digits === "" ? undefined : Number(digits);
}

/**
 * The input's next text and caret after an edit. `raw` is the browser's new
 * value and `caret` its selection end; `prev` is what was shown before.
 * The caret stays after the same number of digits, so separators appearing
 * or vanishing never make it jump. Deleting only a separator deletes the
 * digit beside it instead (Backspace: before, Delete: after).
 */
export function editAmount(
  prev: string,
  raw: string,
  caret: number,
  key?: "Backspace" | "Delete",
): { text: string; caret: number } {
  let digits = raw.replace(/\D/g, "");
  let digitsBefore = raw.slice(0, caret).replace(/\D/g, "").length;

  const onlySeparatorRemoved = raw.length < prev.length && digits === prev.replace(/\D/g, "");
  if (onlySeparatorRemoved && key === "Backspace" && digitsBefore > 0) {
    digits = digits.slice(0, digitsBefore - 1) + digits.slice(digitsBefore);
    digitsBefore -= 1;
  } else if (onlySeparatorRemoved && key === "Delete") {
    digits = digits.slice(0, digitsBefore) + digits.slice(digitsBefore + 1);
  }

  // Leading zeros go; keep the caret on the same digits.
  const stripped = digits.replace(/^0+(?=\d)/, "");
  digitsBefore = Math.max(0, digitsBefore - (digits.length - stripped.length));
  const kept = stripped.slice(0, MAX_AMOUNT_DIGITS);
  digitsBefore = Math.min(digitsBefore, kept.length);

  const text = kept === "" ? "" : groupDigits(kept);
  let next = 0;
  for (let seen = 0; next < text.length && seen < digitsBefore; next++) {
    if (/\d/.test(text[next])) seen++;
  }
  return { text, caret: next };
}
