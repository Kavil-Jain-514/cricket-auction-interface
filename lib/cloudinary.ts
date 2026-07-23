// Cloudinary configuration and utilities

// Upload folders for organization
export const UPLOAD_FOLDERS = {
  players: "cricket-auction/players",
  teams: "cricket-auction/teams",
  tournaments: "cricket-auction/tournaments",
} as const;

export type UploadFolder = keyof typeof UPLOAD_FOLDERS;
