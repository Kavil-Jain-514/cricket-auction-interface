// components/marketing/MarketingHeader.tsx - Site header. The mobile menu is
// a native <details> element, and the header ships no client component: the
// marketing pages have a script-size budget (lighthouserc.json) with almost
// no headroom, and even a one-line island costs about 1 KB.
//
// Signed-in visitors get "Go to dashboard" instead of "Log in" / "Start
// free". The shell has no Clerk, so SESSION_SCRIPT reads Clerk's own readable
// cookie (__client_uat, suffixed on some instances: "0" signed out, a
// timestamp signed in) and marks the header data-session before first paint;
// globals.css hides whichever links don't apply. If the cookie is stale,
// /dashboard's own sign-in check still applies.
import Link from "next/link";
import { MenuIcon } from "lucide-react";

import { buttonVariants } from "@/components/ds/button";
import { Logo } from "@/components/ds/logo";
import { MARKETING_PAGES } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

const MENU_LINK = "fl-focus flex h-11 items-center rounded-control px-3 text-ink hover:bg-surface";

const SESSION_SCRIPT =
  'if(/(?:^|; )__client_uat[^=]*=(?!0(?:;|$))[^;]/.test(document.cookie))document.currentScript.parentElement.setAttribute("data-session","")';

export function MarketingHeader() {
  return (
    // suppressHydrationWarning: SESSION_SCRIPT may add data-session before hydration.
    <header className="fl-glass sticky top-0 z-40 border-b border-line" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: SESSION_SCRIPT }} />
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6">
        <Link href="/" className="fl-focus min-w-0 shrink rounded-control" aria-label="Bid11Pro home">
          <Logo />
        </Link>

        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {MARKETING_PAGES.map((p) => (
              <li key={p.path}>
                <Link
                  href={p.path}
                  className="fl-focus inline-flex h-11 items-center rounded-control px-3 text-sm font-medium text-ink-muted transition-colors duration-(--dur-fast) hover:text-ink"
                >
                  {p.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {/* cn, not cva's className: the base inline-flex must not beat hidden */}
          <Link href="/sign-in" data-signed-out className={cn(buttonVariants({ variant: "ghost" }), "hidden sm:inline-flex")}>
            Log in
          </Link>
          <Link href="/sign-up" data-signed-out className={buttonVariants({ className: "px-4 sm:px-5" })}>
            Start free
          </Link>
          <Link href="/dashboard" data-signed-in className={cn(buttonVariants(), "px-3 text-sm sm:px-5 sm:text-base")}>
            <span className="sm:hidden">Dashboard</span>
            <span className="hidden sm:inline">Go to dashboard</span>
          </Link>
          <details className="group relative lg:hidden">
            <summary
              className="fl-focus inline-flex size-11 cursor-pointer list-none items-center justify-center rounded-control text-ink hover:bg-raised [&::-webkit-details-marker]:hidden"
              aria-label="Menu"
            >
              <MenuIcon className="size-6" />
            </summary>
            <nav
              aria-label="Mobile"
              className="absolute right-0 mt-2 w-64 rounded-card border border-line bg-raised p-2 shadow-floating"
            >
              <ul>
                {MARKETING_PAGES.map((p) => (
                  <li key={p.path}>
                    <Link href={p.path} className={MENU_LINK}>
                      {p.label}
                    </Link>
                  </li>
                ))}
                {/* Signed-in visitors have the Dashboard button already. */}
                <li className="sm:hidden" data-signed-out>
                  <Link href="/sign-in" className={MENU_LINK}>
                    Log in
                  </Link>
                </li>
              </ul>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
