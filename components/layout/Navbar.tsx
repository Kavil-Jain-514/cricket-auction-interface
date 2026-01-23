"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { Trophy, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export function Navbar() {
  const { isSignedIn } = useUser();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href={isSignedIn ? "/dashboard" : "/"} className="flex items-center gap-3 hover:opacity-80 transition">
            <Trophy className="w-8 h-8 text-yellow-500" />
            <span className="text-xl font-bold hidden sm:block">Cricket Auction</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            {isSignedIn ? (
              <>
                <Link href="/dashboard" className="text-slate-300 hover:text-white transition">
                  Dashboard
                </Link>
                <Link href="/tournaments" className="text-slate-300 hover:text-white transition">
                  Tournaments
                </Link>
              </>
            ) : (
              <>
                <Link href="/#features" className="text-slate-300 hover:text-white transition">
                  Features
                </Link>
                <Link href="/#pricing" className="text-slate-300 hover:text-white transition">
                  Pricing
                </Link>
              </>
            )}
          </nav>

          {/* Auth Section */}
          <div className="flex items-center gap-4">
            {isSignedIn ? (
              <UserButton 
                afterSignOutUrl="/"
                appearance={{
                  elements: {
                    avatarBox: "w-10 h-10"
                  }
                }}
              />
            ) : (
              <div className="hidden md:flex gap-3">
                <Link href="/sign-in">
                  <Button variant="ghost">Sign In</Button>
                </Link>
                <Link href="/sign-up">
                  <Button>Get Started</Button>
                </Link>
              </div>
            )}

            {/* Mobile Menu Button */}
            <button
              className="md:hidden p-2"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              <Menu className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden pt-4 pb-2 space-y-3">
            {isSignedIn ? (
              <>
                <Link 
                  href="/dashboard" 
                  className="block text-slate-300 hover:text-white transition"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Dashboard
                </Link>
                <Link 
                  href="/tournaments" 
                  className="block text-slate-300 hover:text-white transition"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Tournaments
                </Link>
              </>
            ) : (
              <>
                <Link href="/sign-in" className="block">
                  <Button variant="ghost" className="w-full">Sign In</Button>
                </Link>
                <Link href="/sign-up" className="block">
                  <Button className="w-full">Get Started</Button>
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}