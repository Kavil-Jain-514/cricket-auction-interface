"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { Menu, ShieldCheck, X } from "lucide-react";
import { Logo } from "@/components/ds/logo";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useUserRole } from "@/hooks/useUserRole";

export function Navbar() {
  const { isSignedIn } = useUser();
  const { isAdmin } = useUserRole();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-50 safe-top">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href={isSignedIn ? "/dashboard" : "/"} className="fl-focus flex items-center rounded-control hover:opacity-80 transition touch-target" aria-label="Bid11Pro home">
            <Logo />
          </Link>

          {/* Auth Section */}
          <div className="flex items-center gap-3 sm:gap-4">
            {isSignedIn && isAdmin && (
              <Link
                href="/admin"
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition touch-target"
              >
                <ShieldCheck className="w-4 h-4" />
                <span className="hidden sm:inline">Admin</span>
              </Link>
            )}
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
            {!isSignedIn && (
              <button
                className="md:hidden p-2.5 rounded-lg hover:bg-slate-800 transition touch-target"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            )}
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && !isSignedIn && (
          <div className="md:hidden pt-4 pb-3 space-y-2 border-t border-slate-800 mt-3">
            <div className="space-y-2 pt-2">
              <Link href="/sign-in" className="block">
                <Button variant="ghost" className="w-full h-12 text-base">Sign In</Button>
              </Link>
              <Link href="/sign-up" className="block">
                <Button className="w-full h-12 text-base">Get Started</Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}