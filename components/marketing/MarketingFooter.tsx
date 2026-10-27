// components/marketing/MarketingFooter.tsx - Footer with the internal links
// every marketing page shares.
import Link from "next/link";

import { Logo } from "@/components/marketing/Logo";
import { MARKETING_PAGES } from "@/lib/marketing/content";

export function MarketingFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1fr_auto]">
        <div className="flex flex-col gap-3">
          <Logo />
          <p className="max-w-sm text-sm text-ink-muted">
            Cricket auction software for IPL-style player auctions at local tournaments.
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="grid grid-cols-2 gap-x-8 sm:grid-cols-3">
            {MARKETING_PAGES.map((p) => (
              <li key={p.path}>
                <Link href={p.path} className="fl-focus inline-flex h-11 items-center rounded-control text-sm text-ink-muted hover:text-ink">
                  {p.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <p className="border-t border-line px-4 py-6 text-center text-sm text-ink-muted">
        © {new Date().getFullYear()} Bid11Pro. Built by{" "}
        <a
          href="https://linkedin.com/in/kaviljain/"
          target="_blank"
          rel="noopener noreferrer"
          className="fl-focus rounded text-signal hover:underline"
        >
          Kavil Jain
        </a>
        .
      </p>
    </footer>
  );
}
