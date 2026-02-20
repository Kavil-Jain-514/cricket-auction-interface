"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

export type UserRole = "admin" | "user" | null;

export function useUserRole() {
  const user = useQuery(api.auth.me);

  const isLoading = user === undefined;
  const isAdmin = user?.role === "admin";
  const isUser = user?.role === "user";
  const role: UserRole = user?.role ?? null;

  return {
    user,
    role,
    isLoading,
    isAdmin,
    isUser,
    // Helper for conditional rendering
    canModify: isAdmin,
    canView: isAdmin || isUser,
  };
}
