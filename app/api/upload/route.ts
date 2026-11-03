import { v2 as cloudinary } from "cloudinary";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { UPLOAD_FOLDERS } from "@/lib/cloudinary";
import { checkUploadedImage } from "@/lib/imageSniff";
import { canUploadToFolder } from "@/convex/policy";

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Sanitize folder name — only allow alphanumeric, hyphens, underscores
function sanitizeFolder(folder: string): string {
  const sanitized = folder.replace(/[^a-zA-Z0-9_-]/g, "");
  // Always prefix with our app namespace to prevent writing to arbitrary Cloudinary paths
  return `cricket-auction/${sanitized || "uploads"}`;
}

/**
 * Who may upload to which folder is canUploadToFolder (convex/policy.ts):
 * tournament images are the owner's (or an organiser creating one), team
 * logos also come from team owners, everything else needs a staff role. A
 * Clerk session alone is not enough: we exchange it for a Convex token and
 * ask the backend. Returns an error response, or null when allowed.
 */
async function requireUploader(folderKey: string): Promise<NextResponse | null> {
  const { userId, getToken } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = await getToken({ template: "convex" });
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(token);
  const me = await convex.query(api.auth.me, {});
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const mine = me.isAdmin ? [] : await convex.query(api.tournaments.listMine, {});
  const allowed = canUploadToFolder(
    {
      isAdmin: me.isAdmin,
      accountType: me.accountType,
      canCreateTournament: me.canCreateTournament,
      staffRoles: mine.map((t) => t.myRole),
    },
    folderKey,
  );
  if (!allowed) {
    return NextResponse.json(
      { error: folderKey === "tournaments" ? "Only the tournament's owner can upload its logo and images" : "You can't upload images here" },
      { status: 403 },
    );
  }
  return null;
}

/** The UPLOAD_FOLDERS key for a requested folder path, or "other". */
function folderKeyOf(folder: string): string {
  const match = Object.entries(UPLOAD_FOLDERS).find(([, path]) => sanitizeFolder(path) === folder);
  return match?.[0] ?? "other";
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const rawFolder = (formData.get("folder") as string) || "general";

    const folder = sanitizeFolder(rawFolder);
    const denied = await requireUploader(folderKeyOf(folder));
    if (denied) return denied;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 5MB" },
        { status: 400 },
      );
    }

    // The bytes decide what this is, never the declared type or the name.
    // SVG is refused: it can carry script and is served from our Cloudinary.
    const buffer = Buffer.from(await file.arrayBuffer());
    const image = checkUploadedImage(new Uint8Array(buffer));
    if (!image.ok) {
      return NextResponse.json({ error: image.error }, { status: 400 });
    }
    const base64 = `data:${image.type};base64,${buffer.toString("base64")}`;

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(base64, {
      folder,
      resource_type: "image",
      transformation: [{ quality: "auto", fetch_format: "auto" }],
    });

    return NextResponse.json({
      success: true,
      publicId: result.public_id,
      url: result.secure_url,
      width: result.width,
      height: result.height,
    });
  } catch (error) {
    console.error("Cloudinary upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload image" },
      { status: 500 },
    );
  }
}
