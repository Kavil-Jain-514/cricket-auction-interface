"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { Menu, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useUserRole } from "@/hooks/useUserRole";

// Cricket Ball SVG Icon Component
export function CricketBallIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="currentColor">
      <circle cx="50" cy="50" r="45" fill="#DC2626" />
      <path
        d="M20 50 Q35 30, 50 50 Q65 70, 80 50"
        fill="none"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M20 50 Q35 70, 50 50 Q65 30, 80 50"
        fill="none"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* Stitching lines */}
      <g stroke="white" strokeWidth="1.5" strokeLinecap="round">
        <line x1="25" y1="42" x2="28" y2="38" />
        <line x1="32" y1="36" x2="35" y2="32" />
        <line x1="40" y1="34" x2="43" y2="30" />
        <line x1="57" y1="30" x2="60" y2="34" />
        <line x1="65" y1="32" x2="68" y2="36" />
        <line x1="72" y1="38" x2="75" y2="42" />
        <line x1="25" y1="58" x2="28" y2="62" />
        <line x1="32" y1="64" x2="35" y2="68" />
        <line x1="40" y1="66" x2="43" y2="70" />
        <line x1="57" y1="70" x2="60" y2="66" />
        <line x1="65" y1="68" x2="68" y2="64" />
        <line x1="72" y1="62" x2="75" y2="58" />
      </g>
    </svg>
  );
}

export function Navbar() {
  const { isSignedIn } = useUser();
  const { isAdmin } = useUserRole();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-50 safe-top">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href={isSignedIn ? "/dashboard" : "/"} className="flex items-center gap-2 sm:gap-3 hover:opacity-80 transition touch-target group">
            <div className="relative">
              <CricketBallIcon className="w-9 h-9 sm:w-10 sm:h-10 group-hover:rotate-180 transition-transform duration-500" />
              <div className="absolute inset-0 bg-red-500/30 blur-lg rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="flex flex-col">
              <span className="text-xl sm:text-2xl font-bold bg-linear-to-r from-red-500 via-orange-400 to-yellow-500 bg-clip-text text-transparent">
                Bid11Pro
              </span>
              <span className="text-[10px] text-slate-500 -mt-1 hidden sm:block">Cricket Auction Platform</span>
            </div>
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