import Link from 'next/link';
import { Trophy, Zap, Users, BarChart3, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Trophy className="w-8 h-8 text-yellow-500" />
            <span className="text-xl font-bold">Cricket Auction</span>
          </div>
          <div className="flex gap-4">
            <Link href="/sign-in">
              <Button variant="ghost">Login</Button>
            </Link>
            <Link href="/sign-up">
              <Button>Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-6 py-20 text-center">
        <div className="inline-block px-4 py-2 bg-blue-600/20 border border-blue-500/30 rounded-full mb-6">
          <span className="text-blue-400 text-sm font-semibold">
            🎯 Professional Cricket Auction Platform
          </span>
        </div>
        
        <h1 className="text-6xl md:text-7xl font-bold mb-6 bg-clip-text text-transparent bg-linear-to-r from-blue-400 via-purple-400 to-pink-400">
          Run Your Cricket
          <br />
          Auction Like a Pro
        </h1>
        
        <p className="text-xl text-slate-300 mb-10 max-w-2xl mx-auto">
          Create tournaments, manage teams, conduct live auctions with real-time bidding, 
          and track statistics—all in one powerful platform.
        </p>

        <div className="flex gap-4 justify-center">
          <Link href="/sign-up">
            <Button size="lg" className="text-lg px-8">
              Start Free Trial
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </Link>
          <Link href="/demo">
            <Button size="lg" variant="outline" className="text-lg px-8">
              Watch Demo
            </Button>
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center mb-4">
              <Zap className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold mb-2">Real-Time Bidding</h3>
            <p className="text-slate-400">
              Live auction experience with instant updates across all devices
            </p>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <div className="w-12 h-12 bg-purple-600 rounded-lg flex items-center justify-center mb-4">
              <Users className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold mb-2">Team Management</h3>
            <p className="text-slate-400">
              Manage multiple teams, track purses, and build squads easily
            </p>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <div className="w-12 h-12 bg-green-600 rounded-lg flex items-center justify-center mb-4">
              <BarChart3 className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold mb-2">Live Statistics</h3>
            <p className="text-slate-400">
              Real-time analytics and insights during and after auctions
            </p>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <div className="w-12 h-12 bg-yellow-600 rounded-lg flex items-center justify-center mb-4">
              <Trophy className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold mb-2">Multi-Tournament</h3>
            <p className="text-slate-400">
              Create unlimited tournaments with custom rules and settings
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-4xl mx-auto px-6 py-20 text-center">
        <div className="bg-linear-to-r from-blue-600 to-purple-600 rounded-2xl p-12">
          <h2 className="text-4xl font-bold mb-4">
            Ready to Get Started?
          </h2>
          <p className="text-lg mb-8 opacity-90">
            Join thousands of cricket enthusiasts running professional auctions
          </p>
          <Link href="/sign-up">
            <Button size="lg" variant="secondary" className="text-lg px-8">
              Create Your First Tournament
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-6 py-8 text-center text-slate-400">
          <p>© 2025 Cricket Auction Manager. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}