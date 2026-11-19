// convex/uploads.ts - Which image URLs we accept on write (AUDIT 2026-11
// SEC-004). Logos, photos, sponsor logos, payment QRs and screenshots are
// rendered for every viewer, the projector and the broadcast overlay, so a
// stored URL must be a file we uploaded: our Cloudinary account, under our
// root folder. A link to any other host (or another Cloudinary account)
// would let a team owner or registrant put their own image on a live screen,
// or a tracking pixel in front of every viewer.
//
// Values are checked only when they change (`previous`), so records saved
// before this rule with an older URL keep working when edited.

export const ROOT_FOLDER = "cricket-auction/";
const MAX_URL_LENGTH = 500;

/** Hosts organisers' spreadsheets link player photos to (PlayerImport turns Drive links into lh3 ones). */
const PLAYER_PHOTO_HOSTS = new Set(["lh3.googleusercontent.com", "drive.google.com"]);

/** Our Cloudinary cloud name from the Convex env, or undefined when not set. */
export function ourCloudName(): string | undefined {
  return process.env.CLOUDINARY_CLOUD_NAME ?? process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
}

/**
 * The Cloudinary public id of one of our stored images, or null for anything
 * else (another cloud or host, outside our folder, not an image upload).
 * Transformations and the version segment are dropped, as is the extension.
 */
export function cloudinaryPublicId(url: string, cloudName: string): string | null {
  const prefix = `https://res.cloudinary.com/${cloudName}/image/upload/`;
  if (!url.startsWith(prefix)) return null;
  const parts = url.slice(prefix.length).split(/[?#]/)[0].split("/");
  while (parts.length > 1 && (parts[0].includes(",") || /^[a-z]{1,2}_/.test(parts[0]))) parts.shift();
  if (parts.length > 1 && /^v\d+$/.test(parts[0])) parts.shift();
  let id: string;
  try {
    id = decodeURIComponent(parts.join("/")).replace(/\.[a-z0-9]+$/i, "");
  } catch {
    return null;
  }
  return id.startsWith(ROOT_FOLDER) ? id : null;
}

/**
 * True when `url` is an image we stored, optionally in `folder` (e.g.
 * "registrations"). Without a configured cloud name (a deployment that
 * hasn't set CLOUDINARY_CLOUD_NAME) only the Cloudinary host is checked, as
 * before this rule, so such a deployment keeps working.
 */
export function isOurUpload(url: string, folder?: string): boolean {
  if (url.length > MAX_URL_LENGTH) return false;
  const cloud = ourCloudName();
  if (!cloud) return url.startsWith("https://res.cloudinary.com/");
  const id = cloudinaryPublicId(url, cloud);
  return id !== null && (folder === undefined || id.startsWith(`${ROOT_FOLDER}${folder}/`));
}

/** Our upload, or (player photos only) a Google Drive image link from an organiser's import. */
export function isAllowedPlayerPhoto(url: string): boolean {
  if (isOurUpload(url)) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && url.length <= MAX_URL_LENGTH && PLAYER_PHOTO_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Throws `message` unless `url` is empty, unchanged from `previous`, or
 * passes `allowed` (default: isOurUpload).
 */
export function assertImageUrl(
  url: string | undefined,
  message: string,
  options: { previous?: string; allowed?: (url: string) => boolean } = {},
): void {
  if (url === undefined || url === "" || url === options.previous) return;
  if (!(options.allowed ?? ((u: string) => isOurUpload(u)))(url)) throw new Error(message);
}
