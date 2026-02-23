import Link from 'next/link';
import { Zap, Users, BarChart3, ArrowRight, Timer, Shield, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Cricket Ball SVG Component
function CricketBall({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="currentColor">
      <circle cx="50" cy="50" r="45" fill="#DC2626" />
      <path d="M20 50 Q35 30, 50 50 Q65 70, 80 50" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" />
      <path d="M20 50 Q35 70, 50 50 Q65 30, 80 50" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" />
      <g stroke="white" strokeWidth="1.5" strokeLinecap="round">
        <line x1="25" y1="42" x2="28" y2="38" /><line x1="32" y1="36" x2="35" y2="32" />
        <line x1="40" y1="34" x2="43" y2="30" /><line x1="57" y1="30" x2="60" y2="34" />
        <line x1="65" y1="32" x2="68" y2="36" /><line x1="72" y1="38" x2="75" y2="42" />
        <line x1="25" y1="58" x2="28" y2="62" /><line x1="32" y1="64" x2="35" y2="68" />
        <line x1="40" y1="66" x2="43" y2="70" /><line x1="57" y1="70" x2="60" y2="66" />
        <line x1="65" y1="68" x2="68" y2="64" /><line x1="72" y1="62" x2="75" y2="58" />
      </g>
    </svg>
  );
}

// Cricket Stumps SVG Component
function CricketStumps({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 100" className={className}>
      <rect x="8" y="10" width="6" height="80" fill="#D4A574" rx="1" />
      <rect x="27" y="10" width="6" height="80" fill="#D4A574" rx="1" />
      <rect x="46" y="10" width="6" height="80" fill="#D4A574" rx="1" />
      <rect x="5" y="8" width="20" height="4" fill="#8B4513" rx="1" />
      <rect x="35" y="8" width="20" height="4" fill="#8B4513" rx="1" />
    </svg>
  );
}

// Cricket Bat SVG Component
function CricketBat({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 120" className={className}>
      <rect x="14" y="0" width="12" height="35" fill="#8B4513" rx="2" />
      <rect x="8" y="35" width="24" height="75" fill="#D4A574" rx="3" />
      <rect x="10" y="40" width="20" height="65" fill="#E5C9A0" rx="2" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white overflow-hidden">
      {/* Animated Background Elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {/* Cricket field gradient at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-linear-to-t from-green-900/20 to-transparent" />

        {/* Floating cricket balls */}
        <div className="absolute top-20 left-10 animate-bounce" style={{ animationDuration: '3s' }}>
          <CricketBall className="w-8 h-8 opacity-20" />
        </div>
        <div className="absolute top-40 right-20 animate-bounce" style={{ animationDuration: '4s', animationDelay: '1s' }}>
          <CricketBall className="w-12 h-12 opacity-15" />
        </div>
        <div className="absolute bottom-40 left-1/4 animate-bounce" style={{ animationDuration: '3.5s', animationDelay: '0.5s' }}>
          <CricketBall className="w-6 h-6 opacity-10" />
        </div>

        {/* Stadium light effects */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-yellow-500/5 rounded-full blur-3xl" />
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-yellow-500/5 rounded-full blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative border-b border-slate-800 bg-slate-900/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 group">
            <div className="relative">
              <CricketBall className="w-10 h-10 group-hover:rotate-180 transition-transform duration-500" />
              <div className="absolute inset-0 bg-red-500/30 blur-lg rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="flex flex-col">
              <span className="text-2xl font-bold bg-linear-to-r from-red-500 via-orange-400 to-yellow-500 bg-clip-text text-transparent">
                Bid11Pro
              </span>
              <span className="text-[10px] text-slate-500 -mt-1">Cricket Auction Platform</span>
            </div>
          </div>
          <div className="flex gap-4">
            <Link href="/sign-in">
              <Button variant="ghost">Login</Button>
            </Link>
            <Link href="/sign-up">
              <Button className="bg-linear-to-r from-red-600 to-orange-500 hover:from-red-700 hover:to-orange-600">Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative max-w-7xl mx-auto px-6 py-20 text-center">
        {/* Cricket Elements Decoration */}
        <div className="absolute left-10 top-1/2 -translate-y-1/2 opacity-20 hidden lg:block">
          <CricketBat className="w-16 h-48 -rotate-12" />
        </div>
        <div className="absolute right-10 top-1/2 -translate-y-1/2 opacity-20 hidden lg:block">
          <CricketStumps className="w-20 h-32" />
        </div>

        <div className="inline-flex items-center gap-2 px-4 py-2 bg-red-600/20 border border-red-500/30 rounded-full mb-6">
          <CricketBall className="w-5 h-5" />
          <span className="text-red-400 text-sm font-semibold">
            The Ultimate Cricket Auction Experience
          </span>
        </div>

        <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold mb-6">
          <span className="bg-clip-text text-transparent bg-linear-to-r from-red-500 via-orange-400 to-yellow-400">
            Bid11Pro
          </span>
          <br />
          <span className="text-white">Run IPL-Style Auctions</span>
        </h1>

        <p className="text-xl text-slate-300 mb-10 max-w-2xl mx-auto">
          Create thrilling cricket auctions with real-time bidding, team management,
          and live statistics. Experience the excitement of professional player auctions!
        </p>

        <div className="flex gap-4 justify-center flex-wrap">
          <Link href="/sign-up">
            <Button size="lg" className="text-lg px-8 bg-linear-to-r from-red-600 to-orange-500 hover:from-red-700 hover:to-orange-600 shadow-lg shadow-red-500/25">
              <Sparkles className="mr-2 w-5 h-5" />
              Start Your Auction
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </Link>
          <Link href="/demo">
            <Button size="lg" variant="outline" className="text-lg px-8 border-slate-600 hover:bg-slate-800">
              Watch Demo
            </Button>
          </Link>
        </div>

        {/* Stats */}
        <div className="mt-16 grid grid-cols-3 gap-8 max-w-2xl mx-auto">
          <div className="text-center">
            <div className="text-4xl font-bold text-red-500">500+</div>
            <div className="text-slate-400 text-sm">Tournaments</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-bold text-orange-500">10K+</div>
            <div className="text-slate-400 text-sm">Players Auctioned</div>
          </div>
          <div className="text-center">
            <div className="text-4xl font-bold text-yellow-500">50K+</div>
            <div className="text-slate-400 text-sm">Live Bids</div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative max-w-7xl mx-auto px-6 py-20">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold mb-4">
            Everything You Need for a
            <span className="bg-clip-text text-transparent bg-linear-to-r from-red-500 to-orange-400"> Perfect Auction</span>
          </h2>
          <p className="text-slate-400 text-lg max-w-2xl mx-auto">
            Professional tools designed for cricket enthusiasts, league organizers, and fantasy sports managers
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 hover:border-red-500/50 transition group">
            <div className="w-14 h-14 bg-linear-to-br from-red-600 to-red-700 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition">
              <Zap className="w-7 h-7" />
            </div>
            <h3 className="text-xl font-bold mb-2">Real-Time Bidding</h3>
            <p className="text-slate-400">
              Experience live auction excitement with instant bid updates across all devices. No delays, no refreshing needed.
            </p>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 hover:border-orange-500/50 transition group">
            <div className="w-14 h-14 bg-linear-to-br from-orange-600 to-orange-700 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition">
              <Users className="w-7 h-7" />
            </div>
            <h3 className="text-xl font-bold mb-2">Team Management</h3>
            <p className="text-slate-400">
              Create teams with custom branding, manage purses, assign captains, and build championship-winning squads.
            </p>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 hover:border-yellow-500/50 transition group">
            <div className="w-14 h-14 bg-linear-to-br from-yellow-600 to-yellow-700 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition">
              <BarChart3 className="w-7 h-7" />
            </div>
            <h3 className="text-xl font-bold mb-2">Live Statistics</h3>
            <p className="text-slate-400">
              Track spending, analyze player values, and get real-time analytics during and after your auctions.
            </p>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 hover:border-green-500/50 transition group">
            <div className="w-14 h-14 bg-linear-to-br from-green-600 to-green-700 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition">
              <Timer className="w-7 h-7" />
            </div>
            <h3 className="text-xl font-bold mb-2">Smart Bid Timer</h3>
            <p className="text-slate-400">
              Configurable countdown timers with auto-reset on new bids. Keep the auction moving at your pace.
            </p>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 hover:border-blue-500/50 transition group">
            <div className="w-14 h-14 bg-linear-to-br from-blue-600 to-blue-700 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition">
              <Shield className="w-7 h-7" />
            </div>
            <h3 className="text-xl font-bold mb-2">Purse Protection</h3>
            <p className="text-slate-400">
              Smart validation ensures teams can always complete their squad. No more budget miscalculations!
            </p>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6 hover:border-purple-500/50 transition group">
            <div className="w-14 h-14 bg-linear-to-br from-purple-600 to-purple-700 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition">
              <CricketBall className="w-7 h-7" />
            </div>
            <h3 className="text-xl font-bold mb-2">Player Database</h3>
            <p className="text-slate-400">
              Import players in bulk, add photos, track stats, and manage player profiles. All player data in one place.
            </p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <div className="relative bg-linear-to-r from-red-600 via-orange-600 to-yellow-600 rounded-2xl p-12 overflow-hidden">
          {/* Background decorations */}
          <div className="absolute top-4 left-4 opacity-20">
            <CricketBall className="w-16 h-16" />
          </div>
          <div className="absolute bottom-4 right-4 opacity-20">
            <CricketStumps className="w-12 h-20" />
          </div>

          <h2 className="text-4xl font-bold mb-4 relative z-10">
            Ready to Host Your Auction?
          </h2>
          <p className="text-lg mb-8 opacity-90 relative z-10">
            Join cricket enthusiasts running professional IPL-style auctions with Bid11Pro
          </p>
          <Link href="/sign-up">
            <Button size="lg" variant="secondary" className="text-lg px-8 relative z-10">
              Create Your First Tournament
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CricketBall className="w-8 h-8" />
              <span className="text-xl font-bold bg-linear-to-r from-red-500 via-orange-400 to-yellow-500 bg-clip-text text-transparent">
                Bid11Pro
              </span>
            </div>
            <p className="text-slate-400 text-sm text-center">
              © 2026 Bid11Pro. Developed by <a href="https://linkedin.com/in/kaviljain/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">Kavil Jain</a>.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}