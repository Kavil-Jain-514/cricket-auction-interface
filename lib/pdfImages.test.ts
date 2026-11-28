import { describe, expect, it } from "vitest";
import { coverCropRect, mapWithConcurrency, pdfImageFormat, pdfImageUrl } from "./pdfImages";

describe("pdfImageUrl", () => {
  it("adds a resized JPEG transform to a plain Cloudinary URL", () => {
    expect(pdfImageUrl("https://res.cloudinary.com/x/image/upload/v1/cricket-auction/players/a.webp")).toBe(
      "https://res.cloudinary.com/x/image/upload/f_jpg,q_80,c_limit,w_300/v1/cricket-auction/players/a.webp",
    );
  });

  it("turns an existing f_auto transform into f_jpg instead of chaining", () => {
    expect(pdfImageUrl("https://res.cloudinary.com/x/image/upload/f_auto,q_auto,w_200/v1/a.png")).toBe(
      "https://res.cloudinary.com/x/image/upload/f_jpg,q_auto,w_200/v1/a.png",
    );
  });

  it("can ask for a PNG so logos keep their transparency", () => {
    expect(pdfImageUrl("https://res.cloudinary.com/x/image/upload/v1/logo.png", { format: "png", width: 400 })).toBe(
      "https://res.cloudinary.com/x/image/upload/f_png,c_limit,w_400/v1/logo.png",
    );
  });

  it("crops player photos around the face at the PDF box's shape", () => {
    expect(pdfImageUrl("https://res.cloudinary.com/x/image/upload/v1/cricket-auction/players/a.webp", { aspect: 0.83 })).toBe(
      "https://res.cloudinary.com/x/image/upload/f_jpg,q_80,c_fill,g_auto:faces,ar_0.83,w_300/v1/cricket-auction/players/a.webp",
    );
  });

  it("leaves Google Drive URLs alone", () => {
    const url = "https://lh3.googleusercontent.com/d/abc=w400";
    expect(pdfImageUrl(url)).toBe(url);
  });
});

describe("pdfImageFormat", () => {
  it("accepts only JPEG and PNG", () => {
    expect(pdfImageFormat("data:image/png;base64,AA")).toBe("PNG");
    expect(pdfImageFormat("data:image/jpeg;base64,AA")).toBe("JPEG");
    expect(pdfImageFormat("data:image/webp;base64,AA")).toBeNull();
    expect(pdfImageFormat("data:image/gif;base64,AA")).toBeNull();
  });
});

describe("mapWithConcurrency", () => {
  it("keeps order and never exceeds the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapWithConcurrency([5, 1, 4, 2, 3, 0], 2, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, n));
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30, 0]);
    expect(peak).toBe(2);
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});

describe("coverCropRect — fills the PDF box without stretching", () => {
  it("trims the sides of a wide photo, keeping the middle", () => {
    expect(coverCropRect(400, 200, 1)).toEqual({ x: 100, y: 0, width: 200, height: 200 });
  });

  it("trims a tall photo mostly from the bottom, so the head stays", () => {
    expect(coverCropRect(200, 400, 1)).toEqual({ x: 0, y: 50, width: 200, height: 200 });
  });

  it("leaves a photo that already has the box's shape alone", () => {
    expect(coverCropRect(300, 360, 300 / 360)).toEqual({ x: 0, y: 0, width: 300, height: 360 });
  });
});
