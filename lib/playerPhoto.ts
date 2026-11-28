// Face-aware player photos, everywhere a player's photo is shown. A plain
// `object-cover` crop keeps the middle of the photo, so a portrait shot or an
// off-centre face loses the head. For our Cloudinary uploads we ask Cloudinary
// to crop around the face(s) instead. Anything else (Google Drive links from
// player import) can't be cropped server side: small boxes anchor the crop
// towards the top (FACE_POSITION), and PlayerAvatar shows it whole
// (`object-contain`) over a blurred copy on the big screens.

/** True for one of our untransformed Cloudinary uploads. */
export function canFaceCrop(url: string | null | undefined): url is string {
  return !!url && url.includes("res.cloudinary.com") && url.includes("/upload/") && !url.includes("/f_auto");
}

/**
 * Cloudinary crop parameters that keep every face in frame (`g_auto:faces`
 * keeps both people in a couple photo, and falls back to the most salient
 * region when no face is found). `aspect` is width / height, as "1:1" or a
 * decimal such as "0.8".
 */
export function faceCrop(aspect: string, width: number): string {
  return `c_fill,g_auto:faces,ar_${aspect},w_${width}`;
}

/**
 * A crop of `url` centred on the player's face, `width` pixels wide and
 * square unless `aspect` says otherwise. Non-Cloudinary and
 * already-transformed URLs are returned unchanged.
 */
export function facePhotoUrl(url: string | null | undefined, width: number, aspect = "1:1"): string | undefined {
  if (!url) return undefined;
  if (!canFaceCrop(url)) return url;
  return url.replace("/upload/", `/upload/${faceCrop(aspect, width)}/f_auto,q_auto/`);
}

/**
 * Tailwind object-position for photos we can't crop server side: faces sit in
 * the upper third of most player photos, so trim mostly from the bottom.
 */
export const FACE_POSITION = "object-[50%_25%]";
