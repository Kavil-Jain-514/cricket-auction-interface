import { describe, expect, it } from "vitest";
import { fitContain, sponsorColumns, sponsorGridHeight } from "./pdfBranding";

const layout = { tileW: 30, tileH: 18, gap: 4 };

describe("fitContain", () => {
  it("fits a wide logo to the box width and centres it vertically", () => {
    expect(fitContain(400, 100, 40, 20)).toEqual({ w: 40, h: 10, dx: 0, dy: 5 });
  });

  it("fits a tall logo to the box height and centres it horizontally", () => {
    expect(fitContain(100, 200, 40, 20)).toEqual({ w: 10, h: 20, dx: 15, dy: 0 });
  });

  it("falls back to the box for an image with no size", () => {
    expect(fitContain(0, 0, 40, 20)).toEqual({ w: 40, h: 20, dx: 0, dy: 0 });
  });
});

describe("sponsor grid", () => {
  it("fits as many columns as the width allows, at least one", () => {
    expect(sponsorColumns(170, layout)).toBe(5); // 5*30 + 4*4 = 166
    expect(sponsorColumns(10, layout)).toBe(1);
  });

  it("is empty with no sponsors and grows by row", () => {
    expect(sponsorGridHeight(0, 170, layout)).toBe(0);
    const oneRow = sponsorGridHeight(5, 170, layout);
    expect(sponsorGridHeight(6, 170, layout)).toBeCloseTo(oneRow + 18 + 4.5 + 4);
  });
});
