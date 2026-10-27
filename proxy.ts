import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

// Routes that require authentication.
// /auction/<roomId> is deliberately public so projectors and phones can watch
// without signing in (viewer mode). Admin controls are enforced by Convex.
// /auction/<roomId>/overlay (the OBS/vMix broadcast overlay) is public too:
// a venue PC's Browser Source has no session.
// /results/<tournamentId> (public results, shared on WhatsApp) is public too;
// getPublicResults only returns data for completed, active tournaments.
// /register/<tournamentId> (public player registration) is public too; the
// form only works while the organiser has registration open.
const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/tournament(.*)",
  "/auction/create(.*)",
  // Back office: sign in first; app/(app)/admin/layout.tsx shows non-admins a 403.
  "/admin(.*)",
  // Owner invite links: sign in first, then the page claims the invite.
  "/join(.*)",
]);

// Routes that are always public (auth pages, landing, API routes handled separately)
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/upload(.*)", // Already has its own Clerk auth check
]);

// Static marketing pages (app/(marketing)) and their metadata files never
// read auth. Skipping Clerk here avoids its handshake redirect, which on a
// first visit costs two round trips before the page even starts loading.
const isMarketingRoute = createRouteMatcher([
  "/",
  "/features",
  "/pricing",
  "/how-it-works",
  "/for-organisers",
  "/broadcast",
  "/faq",
  "/design",
  "/robots.txt",
  "/sitemap.xml",
  "/opengraph-image(.*)",
  "/twitter-image(.*)",
]);

const clerk = clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req) && !isPublicRoute(req)) {
    await auth.protect();
  }
});

export default function proxy(req: NextRequest, event: NextFetchEvent) {
  if (isMarketingRoute(req)) return NextResponse.next();
  return clerk(req, event);
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
