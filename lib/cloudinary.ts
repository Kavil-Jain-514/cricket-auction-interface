// Cloudinary configuration and utilities

export const CLOUDINARY_CONFIG = {
  cloudName: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME!,
  uploadPreset: process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET!,
};

// Upload folders for organization
export const UPLOAD_FOLDERS = {
  players: "cricket-auction/players",
  teams: "cricket-auction/teams",
  tournaments: "cricket-auction/tournaments",
} as const;

export type UploadFolder = keyof typeof UPLOAD_FOLDERS;

// Image transformations for different use cases
export const IMAGE_TRANSFORMS = {
  thumbnail: "w_100,h_100,c_fill,g_face,q_auto,f_auto",
  playerCard: "w_200,h_200,c_fill,g_face,q_auto,f_auto",
  teamLogo: "w_150,h_150,c_fill,q_auto,f_auto",
  tournamentLogo: "w_300,h_300,c_fill,q_auto,f_auto",
  fullSize: "w_800,h_800,c_limit,q_auto,f_auto",
} as const;

/**
 * Get optimized Cloudinary URL with transformations
 */
export function getOptimizedImageUrl(
  publicId: string,
  transform: keyof typeof IMAGE_TRANSFORMS = "thumbnail",
): string {
  if (!publicId) return "";

  // If it's already a full URL (legacy), return as is
  if (publicId.startsWith("http")) {
    return publicId;
  }

  const cloudName = CLOUDINARY_CONFIG.cloudName;
  const transformation = IMAGE_TRANSFORMS[transform];

  return `https://res.cloudinary.com/${cloudName}/image/upload/${transformation}/${publicId}`;
}

/**
 * Extract public ID from Cloudinary URL
 */
export function extractPublicId(url: string): string | null {
  if (!url) return null;

  // Match pattern: /upload/[transformations/]public_id.ext
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/);
  return match ? match[1] : null;
}
