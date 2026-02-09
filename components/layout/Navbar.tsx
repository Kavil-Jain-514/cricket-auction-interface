"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { Trophy, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export function Navbar() {
  const { isSignedIn } = useUser();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-50 safe-top">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href={isSignedIn ? "/dashboard" : "/"} className="flex items-center gap-2 sm:gap-3 hover:opacity-80 transition touch-target">
            <Trophy className="w-8 h-8 sm:w-9 sm:h-9 text-yellow-500" />
            <span className="text-lg sm:text-xl font-bold">Cricket Auction</span>
          </Link>

          {/* Desktop/Tablet Navigation */}
          <nav className="hidden md:flex items-center gap-4 lg:gap-6">
            {isSignedIn ? (
              <>
                <Link href="/dashboard" className="text-slate-300 hover:text-white transition px-3 py-2 rounded-lg hover:bg-slate-800/50 touch-target">
                  Dashboard
                </Link>
              </>
            ) : (
              <>
                <Link href="/#features" className="text-slate-300 hover:text-white transition px-3 py-2 rounded-lg hover:bg-slate-800/50 touch-target">
                  Features
                </Link>
                <Link href="/#pricing" className="text-slate-300 hover:text-white transition px-3 py-2 rounded-lg hover:bg-slate-800/50 touch-target">
                  Pricing
                </Link>
              </>
            )}
          </nav>

          {/* Auth Section */}
          <div className="flex items-center gap-3 sm:gap-4">
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
              className="md:hidden p-2.5 rounded-lg hover:bg-slate-800 transition touch-target"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden pt-4 pb-3 space-y-2 border-t border-slate-800 mt-3">
            {isSignedIn ? (
              <>
                <Link 
                  href="/dashboard" 
                  className="flex items-center text-slate-300 hover:text-white hover:bg-slate-800/50 transition px-3 py-3 rounded-lg touch-target"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Dashboard
                </Link>
                <Link 
                  href="/tournaments" 
                  className="flex items-center text-slate-300 hover:text-white hover:bg-slate-800/50 transition px-3 py-3 rounded-lg touch-target"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Tournaments
                </Link>
              </>
            ) : (
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