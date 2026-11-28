import { describe, expect, test } from "vitest";
import { FACE_POSITION, facePhotoUrl, canFaceCrop } from "./playerPhoto";

const CLOUD = "https://res.cloudinary.com/demo/image/upload/v1712/cricket-auction/registrations/abc.jpg";
const DRIVE = "https://lh3.googleusercontent.com/d/abc123";

describe("canFaceCrop", () => {
  test("our plain Cloudinary uploads can be cropped", () => {
    expect(canFaceCrop(CLOUD)).toBe(true);
  });

  test("Drive links, already-transformed URLs and empty values cannot", () => {
    expect(canFaceCrop(DRIVE)).toBe(false);
    expect(canFaceCrop(CLOUD.replace("/upload/", "/upload/f_auto,w_200/"))).toBe(false);
    expect(canFaceCrop(undefined)).toBe(false);
    expect(canFaceCrop(null)).toBe(false);
    expect(canFaceCrop("")).toBe(false);
  });
});

describe("facePhotoUrl", () => {
  test("asks Cloudinary for a square crop centred on the face, at the requested width", () => {
    expect(facePhotoUrl(CLOUD, 384)).toBe(
      "https://res.cloudinary.com/demo/image/upload/c_fill,g_auto:faces,ar_1:1,w_384/f_auto,q_auto/v1712/cricket-auction/registrations/abc.jpg",
    );
  });

  test("keeps every face in a couple photo, not just one", () => {
    expect(facePhotoUrl(CLOUD, 384)).toContain("g_auto:faces");
  });

  test("can crop to a non-square box", () => {
    expect(facePhotoUrl(CLOUD, 300, "0.8")).toContain("/upload/c_fill,g_auto:faces,ar_0.8,w_300/f_auto,q_auto/");
  });

  test("non-Cloudinary URLs come back unchanged", () => {
    expect(facePhotoUrl(DRIVE, 384)).toBe(DRIVE);
  });

  test("already-transformed Cloudinary URLs are not transformed twice", () => {
    const done = CLOUD.replace("/upload/", "/upload/f_auto,q_auto,w_200/");
    expect(facePhotoUrl(done, 384)).toBe(done);
  });

  test("no photo gives no URL", () => {
    expect(facePhotoUrl(undefined, 384)).toBeUndefined();
    expect(facePhotoUrl(null, 384)).toBeUndefined();
    expect(facePhotoUrl("", 384)).toBeUndefined();
  });
});

describe("FACE_POSITION", () => {
  test("anchors uncroppable photos towards the top, where the face usually is", () => {
    expect(FACE_POSITION).toBe("object-[50%_25%]");
  });
});
