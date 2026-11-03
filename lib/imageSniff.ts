// lib/imageSniff.ts - What an uploaded file really is, read from its bytes
// (the browser's declared type and the file name are both the uploader's
// claim). Only JPEG, PNG and WebP are accepted; SVG and anything with markup
// never are. Pure, for /api/upload and its tests.

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

const MIN_SIDE = 32;
const MAX_SIDE = 6000;

const ascii = (b: Uint8Array, at: number, text: string) =>
  b.length >= at + text.length && [...text].every((c, i) => b[at + i] === c.charCodeAt(0));
const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u16le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u24le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1];
    // SOF0-SOF15 carry the size, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: u16be(b, at + 5), width: u16be(b, at + 7) };
    }
    at += 2 + u16be(b, at + 2);
  }
  return null;
}

/** Type and pixel size from the file's header, or null when it isn't a supported image. */
export function sniffImage(b: Uint8Array): { type: ImageType; width: number; height: number } | null {
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, "PNG\r\n\x1a\n") && ascii(b, 12, "IHDR")) {
    return { type: "image/png", width: u32be(b, 16), height: u32be(b, 20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    const size = jpegSize(b);
    return size ? { type: "image/jpeg", ...size } : null;
  }
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) {
    if (ascii(b, 12, "VP8 ") && b.length >= 30) {
      return { type: "image/webp", width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
    }
    if (ascii(b, 12, "VP8L") && b.length >= 25) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { type: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (ascii(b, 12, "VP8X") && b.length >= 30) {
      return { type: "image/webp", width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
    }
  }
  return null;
}

/**
 * The upload checks: a real JPEG/PNG/WebP within sensible pixel limits. The
 * declared type is ignored on purpose; only the bytes count.
 */
export function checkUploadedImage(b: Uint8Array): { ok: true; type: ImageType } | { ok: false; error: string } {
  const image = sniffImage(b);
  if (!image) return { ok: false, error: "Upload a JPG, PNG or WebP image" };
  if (image.width < MIN_SIDE || image.height < MIN_SIDE) {
    return { ok: false, error: `Image is too small (at least ${MIN_SIDE} × ${MIN_SIDE} pixels)` };
  }
  if (image.width > MAX_SIDE || image.height > MAX_SIDE) {
    return { ok: false, error: `Image is too large (at most ${MAX_SIDE} pixels on a side)` };
  }
  return { ok: true, type: image.type };
}
