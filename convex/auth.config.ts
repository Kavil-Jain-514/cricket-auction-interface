import { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      // Configure CLERK_JWT_ISSUER_DOMAIN on the Convex Dashboard
      // Go to: Convex Dashboard → Settings → Environment Variables
      // Add: CLERK_JWT_ISSUER_DOMAIN = https://your-clerk-app.clerk.accounts.dev
      // See https://docs.convex.dev/auth/clerk#configuring-dev-and-prod-instances
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
