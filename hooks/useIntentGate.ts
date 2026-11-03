"use client";

import { useEffect } from "react";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";

/**
 * Sends a signed-in user who hasn't chosen organiser / team owner / viewer to
 * the /welcome step, then back to `returnTo`. Returns `me` (undefined while
 * loading). The server enforces every rule; this only routes.
 */
export function useIntentGate(returnTo: string) {
  const router = useRouter();
  const me = useQuery(api.auth.me, {});
  const needsIntent = me !== undefined && me !== null && !me.isAdmin && me.accountType === undefined;

  useEffect(() => {
    if (needsIntent) router.replace(`/welcome?next=${encodeURIComponent(returnTo)}`);
  }, [needsIntent, returnTo, router]);

  return { me, needsIntent };
}
