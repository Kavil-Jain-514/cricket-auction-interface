import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

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
  // Back office: sign in first; app/admin/layout.tsx shows non-admins a 403.
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

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req) && !isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
