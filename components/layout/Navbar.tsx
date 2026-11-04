"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutDashboard, Menu, ShieldCheck, X } from "lucide-react";
import { Logo } from "@/components/ds/logo";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useUserRole } from "@/hooks/useUserRole";
import { cn } from "@/lib/utils";

type NavLink = { href: string; label: string; icon: typeof Home };

/** "/" is only active on itself; other links also cover their sub-pages. */
function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Navbar() {
  const { isSignedIn } = useUser();
  const { isAdmin } = useUserRole();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const links: NavLink[] = [
    { href: "/", label: "Home", icon: Home },
    ...(isSignedIn ? [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] : []),
    ...(isSignedIn && isAdmin ? [{ href: "/admin", label: "Admin", icon: ShieldCheck }] : []),
  ];

  return (
    <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-50 safe-top">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-4">
        <div className="flex items-center justify-between">
          {/* Logo: always the landing page, signed in or not */}
          <Link href="/" className="fl-focus flex items-center rounded-control hover:opacity-80 transition touch-target" aria-label="Bid11Pro home">
            <Logo />
          </Link>

          <div className="flex items-center gap-3 sm:gap-4">
            <nav aria-label="Main" className="hidden md:block">
              <ul className="flex items-center gap-1">
                {links.map(({ href, label, icon: Icon }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={isActive(pathname, href) ? "page" : undefined}
                      className={cn(
                        "fl-focus inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition touch-target",
                        isActive(pathname, href) && "bg-slate-800 text-white",
                      )}
                    >
                      <Icon className="w-4 h-4" aria-hidden />
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            {isSignedIn ? (
              <UserButton
                afterSignOutUrl="/"
                appearance={{
                  elements: {
                    avatarBox: "w-10 h-10 sm:w-11 sm:h-11"
                  }
                }}
              />
            ) : (
              <div className="hidden md:flex gap-2 lg:gap-3">
                <Link href="/sign-in">
                  <Button variant="ghost" className="h-11 px-4 text-base">Sign In</Button>
                </Link>
                <Link href="/sign-up">
                  <Button className="h-11 px-5 text-base">Get Started</Button>
                </Link>
              </div>
            )}

            {/* Mobile Menu Button */}
            <button
              className="fl-focus md:hidden p-2.5 rounded-lg hover:bg-slate-800 transition touch-target"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-menu"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div id="mobile-menu" className="md:hidden pt-4 pb-3 space-y-2 border-t border-slate-800 mt-3">
            <nav aria-label="Mobile">
              <ul className="space-y-1">
                {links.map(({ href, label, icon: Icon }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={() => setMobileMenuOpen(false)}
                      aria-current={isActive(pathname, href) ? "page" : undefined}
                      className={cn(
                        "fl-focus flex h-12 items-center gap-3 rounded-lg px-3 text-base text-slate-200 hover:bg-slate-800",
                        isActive(pathname, href) && "bg-slate-800 text-white",
                      )}
                    >
                      <Icon className="w-5 h-5" aria-hidden />
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            {!isSignedIn && (
              <div className="space-y-2 pt-2">
                <Link href="/sign-in" className="block">
                  <Button variant="ghost" className="w-full h-12 text-base">Sign In</Button>
                </Link>
                <Link href="/sign-up" className="block">
                  <Button className="w-full h-12 text-base">Get Started</Button>
                </Link>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
