import { describe, expect, test } from "vitest";
import { checkUploadedImage, sniffImage } from "./imageSniff";

const bytes = (...parts: Array<number[] | string>) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16be = (n: number) => [(n >>> 8) & 255, n & 255];
const u16le = (n: number) => [n & 255, (n >>> 8) & 255];
const u24le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];

const png = (w: number, h: number) =>
  bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], u32be(13), "IHDR", u32be(w), u32be(h), [8, 6, 0, 0, 0]);
// SOI, an APP0 segment, then SOF0 with height/width.
const jpeg = (w: number, h: number) =>
  bytes([0xff, 0xd8], [0xff, 0xe0], u16be(16), "JFIF", [0, 1, 1, 0, 0, 1, 0, 1, 0, 0], [0xff, 0xc0], u16be(17), [8], u16be(h), u16be(w), [3]);
const webpLossy = (w: number, h: number) =>
  bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8 ", [0, 0, 0, 0], [0, 0, 0], [0x9d, 0x01, 0x2a], u16le(w), u16le(h));
const webpExtended = (w: number, h: number) =>
  bytes("RIFF", [0, 0, 0, 0], "WEBP", "VP8X", [10, 0, 0, 0], [0, 0, 0, 0], u24le(w - 1), u24le(h - 1));

describe("sniffImage", () => {
  test.each([
    ["png", png(800, 600), { type: "image/png", width: 800, height: 600 }],
    ["jpeg", jpeg(1024, 768), { type: "image/jpeg", width: 1024, height: 768 }],
    ["webp (lossy)", webpLossy(320, 240), { type: "image/webp", width: 320, height: 240 }],
    ["webp (extended)", webpExtended(4000, 3000), { type: "image/webp", width: 4000, height: 3000 }],
  ])("reads %s type and size from the bytes", (_label, data, expected) => {
    expect(sniffImage(data)).toEqual(expected);
  });

  test.each([
    ["a GIF", bytes("GIF89a", [1, 0, 1, 0])],
    ["an SVG", bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ["HTML named .png", bytes("<html><script>alert(1)</script></html>")],
    ["a truncated PNG", png(10, 10).slice(0, 12)],
    ["empty", new Uint8Array()],
  ])("rejects %s", (_label, data) => {
    expect(sniffImage(data)).toBeNull();
  });
});

describe("checkUploadedImage", () => {
  test("the bytes decide: a PNG is a PNG, markup is refused", () => {
    expect(checkUploadedImage(png(400, 400))).toEqual({ ok: true, type: "image/png" });
    expect(checkUploadedImage(bytes("<svg/>"))).toEqual({ ok: false, error: "Upload a JPG, PNG or WebP image" });
  });

  test("dimension limits", () => {
    expect(checkUploadedImage(png(16, 16))).toEqual({ ok: false, error: "Image is too small (at least 32 × 32 pixels)" });
    expect(checkUploadedImage(png(9000, 100))).toEqual({ ok: false, error: "Image is too large (at most 6000 pixels on a side)" });
  });
});
