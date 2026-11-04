"use client";

// components/marketing/AccountLinks.tsx - The header's account links. The
// marketing shell ships no Clerk, so this reads Clerk's own readable cookie:
// __client_uat (suffixed on some instances) is "0" when signed out and a
// timestamp when signed in. The server render is the signed-out version;
// a signed-in visitor sees "Go to dashboard" once this hydrates. If the cookie
// is stale, /dashboard's own sign-in check still applies.
import { useSyncExternalStore } from "react";
import Link from "next/link";

import { buttonVariants } from "@/components/ds/button";

function hasClerkSession(): boolean {
  return document.cookie.split("; ").some((pair) => {
    const [name, value = ""] = pair.split("=");
    return name.startsWith("__client_uat") && value !== "" && value !== "0";
  });
}

const noSubscribe = () => () => {};

function useHasSession(): boolean {
  return useSyncExternalStore(noSubscribe, hasClerkSession, () => false);
}

/** Header buttons: "Log in" and "Start free", or "Go to dashboard". */
export function AccountButtons() {
  if (useHasSession()) {
    return (
      <Link href="/dashboard" className={buttonVariants({ className: "px-4 sm:px-5" })}>
        Go to dashboard
      </Link>
    );
  }
  return (
    <>
      <Link href="/sign-in" className={buttonVariants({ variant: "ghost", className: "hidden sm:inline-flex" })}>
        Log in
      </Link>
      <Link href="/sign-up" className={buttonVariants({ className: "px-4 sm:px-5" })}>
        Start free
      </Link>
    </>
  );
}

/** The phone menu's "Log in" row; signed-in visitors have the dashboard button already. */
export function AccountMenuItem({ className }: { className: string }) {
  if (useHasSession()) return null;
  return (
    <li className="sm:hidden">
      <Link href="/sign-in" className={className}>
        Log in
      </Link>
    </li>
  );
}
