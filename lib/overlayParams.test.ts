import { describe, expect, test } from "vitest";
import { overlayUrl, parseOverlayParams } from "./overlayParams";

describe("parseOverlayParams", () => {
  test("defaults: lower-third, dark, no safe margins", () => {
    expect(parseOverlayParams({})).toEqual({
      mode: "lower-third",
      theme: "dark",
      safe: false,
    });
  });

  test("reads every supported value", () => {
    expect(
      parseOverlayParams({ mode: "full", theme: "light", safe: "1" }),
    ).toEqual({ mode: "full", theme: "light", safe: true });
  });

  test("unknown values fall back to defaults; arrays use the first value", () => {
    expect(
      parseOverlayParams({ mode: "sidebar", theme: ["light", "dark"], safe: "yes" }),
    ).toEqual({ mode: "lower-third", theme: "light", safe: false });
  });
});

describe("overlayUrl", () => {
  test("builds the Browser Source URL for a room", () => {
    expect(
      overlayUrl("https://bid11pro.example", "room123", {
        mode: "full",
        theme: "dark",
        safe: true,
      }),
    ).toBe("https://bid11pro.example/auction/room123/overlay?mode=full&theme=dark&safe=1");
  });
});
