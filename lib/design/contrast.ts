// lib/design/contrast.ts - WCAG 2.2 contrast maths for the design tokens.
// Pure (no DOM) so the token test, the /design page and TeamChip share it.

/** "#rgb" or "#rrggbb" -> [r, g, b] in 0..255. Throws on anything else. */
export function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Not a hex colour: ${hex}`);
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance, 0 (black) .. 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast ratio between two colours, 1..21. Order doesn't matter. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG 2.2 AA thresholds: 4.5 for body text, 3 for large text and UI. */
export const AA_TEXT = 4.5;
export const AA_LARGE_OR_UI = 3;

/**
 * Text colour to put on a team colour: whichever of the two candidates
 * contrasts more. Team colours are organiser-picked, so this is how a
 * TeamChip stays readable whatever the colour.
 */
export function readableOn(bg: string, light = "#ffffff", dark = "#070b14"): string {
  return contrastRatio(bg, light) >= contrastRatio(bg, dark) ? light : dark;
}
