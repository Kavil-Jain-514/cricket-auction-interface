import { v2 as cloudinary } from "cloudinary";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";

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
 * Only Convex admins may upload or delete images. A Clerk session alone is not
 * enough: we exchange it for a Convex token and ask the backend (auth.me) for
 * the caller's role. Returns an error response, or null when the caller is an
 * admin.
 */
async function requireConvexAdmin(): Promise<NextResponse | null> {
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
  if (!me?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    // Authorization check — admins only
    const denied = await requireConvexAdmin();
    if (denied) return denied;

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const rawFolder = (formData.get("folder") as string) || "general";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type
    // SVG is excluded: it can carry script and is served from our Cloudinary.
    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: JPG, PNG, WebP" },
        { status: 400 },
      );
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 5MB" },
        { status: 400 },
      );
    }

    // Sanitize folder path
    const folder = sanitizeFolder(rawFolder);

    // Convert file to base64
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = `data:${file.type};base64,${buffer.toString("base64")}`;

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
