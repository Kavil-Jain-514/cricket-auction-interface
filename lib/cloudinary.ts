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
