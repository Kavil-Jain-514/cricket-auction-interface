// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { AA_LARGE_OR_UI, AA_TEXT, contrastRatio, parseHex, readableOn } from "./contrast";

/** The `--fl-*` hex tokens declared in the block that opens with `selector {`. */
function tokens(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No block for ${selector}`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/--fl-([a-z-]+):\s*(#[0-9a-f]{3,6});/gi)].map((m) => [m[1], m[2]]),
  );
}

const css = readFileSync(fileURLToPath(new URL("../../app/globals.css", import.meta.url)), "utf8");
const themes = {
  dark: tokens(css, '[data-theme="dark"]'),
  light: tokens(css, '[data-theme="light"]'),
};

const BACKGROUNDS = ["canvas", "surface", "raised"];
// Body-size text on every background.
const TEXT = ["ink", "ink-muted", "signal", "sold", "unsold", "timer"];
// UI boundaries and focus indicators (WCAG 1.4.11).
const UI = ["line-strong", "focus", "signal"];

describe.each(Object.entries(themes))("%s theme tokens", (_name, t) => {
  test("declares every role", () => {
    for (const role of [...BACKGROUNDS, ...TEXT, ...UI, "line", "signal-ink"]) {
      expect(t[role], role).toMatch(/^#/);
    }
  });

  test.each(TEXT.flatMap((fg) => BACKGROUNDS.map((bg) => [fg, bg])))(
    "%s text on %s passes 4.5:1",
    (fg, bg) => {
      expect(contrastRatio(t[fg], t[bg])).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  test.each(UI.flatMap((fg) => BACKGROUNDS.map((bg) => [fg, bg])))(
    "%s UI on %s passes 3:1",
    (fg, bg) => {
      expect(contrastRatio(t[fg], t[bg])).toBeGreaterThanOrEqual(AA_LARGE_OR_UI);
    },
  );

  test("text on the signal accent passes 4.5:1", () => {
    expect(contrastRatio(t["signal-ink"], t.signal)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("contrast maths", () => {
  test("black on white is 21:1 and is symmetric", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(21, 5);
  });

  test("same colour is 1:1", () => {
    expect(contrastRatio("#22d3ee", "#22d3ee")).toBe(1);
  });

  test("rejects non-hex input", () => {
    expect(() => parseHex("oklch(1 0 0)")).toThrow();
  });

  test("readableOn picks the stronger of light and dark text", () => {
    expect(readableOn("#ffd700")).toBe("#070b14");
    expect(readableOn("#1e3a8a")).toBe("#ffffff");
    for (const team of ["#ffd700", "#1e3a8a", "#e11d48", "#16a34a", "#7c3aed", "#f97316"]) {
      expect(contrastRatio(readableOn(team), team)).toBeGreaterThanOrEqual(AA_LARGE_OR_UI);
    }
  });
});
