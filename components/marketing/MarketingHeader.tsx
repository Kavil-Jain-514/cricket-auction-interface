// components/marketing/MarketingHeader.tsx - Site header. The mobile menu is
// a native <details> element, so the header ships no JavaScript.
import Link from "next/link";
import { MenuIcon } from "lucide-react";

import { buttonVariants } from "@/components/ds/button";
import { Logo } from "@/components/marketing/Logo";
import { MARKETING_PAGES } from "@/lib/marketing/content";

const NAV = MARKETING_PAGES.filter((p) => p.path !== "/");

export function MarketingHeader() {
  return (
    <header className="fl-glass sticky top-0 z-40 border-b border-line">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6">
        <Link href="/" className="fl-focus min-w-0 shrink rounded-control" aria-label="Bid11Pro home">
          <Logo />
        </Link>

        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {NAV.map((p) => (
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
          <Link href="/sign-in" className={buttonVariants({ variant: "ghost", className: "hidden sm:inline-flex" })}>
            Log in
          </Link>
          <Link href="/sign-up" className={buttonVariants({ className: "px-4 sm:px-5" })}>
            Start free
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
                {NAV.map((p) => (
                  <li key={p.path}>
                    <Link
                      href={p.path}
                      className="fl-focus flex h-11 items-center rounded-control px-3 text-ink hover:bg-surface"
                    >
                      {p.label}
                    </Link>
                  </li>
                ))}
                <li className="sm:hidden">
                  <Link href="/sign-in" className="fl-focus flex h-11 items-center rounded-control px-3 text-ink hover:bg-surface">
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
