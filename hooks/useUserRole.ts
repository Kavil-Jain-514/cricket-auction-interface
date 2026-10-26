"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export type UserRole = "admin" | "user" | null;

export function useUserRole() {
  // Signed out is a normal state (public auction viewers), not an error:
  // skip the `me` query and report a non-admin with no role.
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.auth.me, isAuthenticated ? {} : "skip");
  const user = isAuthLoading ? undefined : isAuthenticated ? me : null;

  const isLoading = user === undefined;
  const isAdmin = user?.role === "admin";
  const isUser = user?.role === "user";
  const role: UserRole = user?.role ?? null;

  return {
    user,
    role,
    isLoading,
    isSignedIn: isAuthenticated,
    isAdmin,
    isUser,
    // Helper for conditional rendering
    canModify: isAdmin,
    canView: isAdmin || isUser,
  };
}
