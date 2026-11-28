// Cloudinary configuration and utilities
import { faceCrop } from "@/lib/playerPhoto";

// Upload folders for organization
export const UPLOAD_FOLDERS = {
  players: "cricket-auction/players",
  teams: "cricket-auction/teams",
  tournaments: "cricket-auction/tournaments",
} as const;

export type UploadFolder = keyof typeof UPLOAD_FOLDERS;

/**
 * next/image loader for Cloudinary URLs: Cloudinary resizes and picks the
 * format (f_auto, so AVIF/WebP), so Next's optimiser doesn't process the
 * image a second time. Pass it only for Cloudinary URLs (isCloudinaryUrl).
 * Same transform as optimizeImageUrl in lib/utils, inlined so client
 * bundles that use it don't pull in clsx and tailwind-merge.
 */
export function cloudinaryLoader({ src, width }: { src: string; width: number }): string {
  return src.replace("/upload/", `/upload/f_auto,q_auto,w_${width}/`);
}

/** cloudinaryLoader with a square crop around the face(s), for player photos. */
export function cloudinaryFaceLoader({ src, width }: { src: string; width: number }): string {
  return src.replace("/upload/", `/upload/${faceCrop("1:1", width)}/f_auto,q_auto/`);
}

export function isCloudinaryUrl(url: string): boolean {
  return url.includes("res.cloudinary.com") && !url.includes("/f_auto");
}
