"use client";

import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Trophy } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ImageUpload } from '@/components/ui/image-upload';
import { toast } from 'sonner';

export default function CreateTournamentPage() {
  const router = useRouter();
  const createTournament = useMutation(api.tournaments.create);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    logoUrl: '',
    basePurse: 4000000,
    minBidIncrement: 25000,
    bidTimerSeconds: 30,
    maxPlayersPerTeam: 15,
  });

  const [loading, setLoading] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const tournamentId = await createTournament({
        name: formData.name,
        description: formData.description,
        logoUrl: logoPreview || undefined,
        settings: {
          basePurse: formData.basePurse,
          minBidIncrement: formData.minBidIncrement,
          bidTimerSeconds: formData.bidTimerSeconds,
          maxPlayersPerTeam: formData.maxPlayersPerTeam,
        },
      });

      toast.success('Tournament created successfully!');
      router.push(`/tournament/${tournamentId}`);
    } catch (error) {
      toast.error('Failed to create tournament');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <Link href="/dashboard" className="flex items-center gap-2 text-slate-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
            Back to Dashboard
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Trophy className="w-8 h-8 text-yellow-500" />
            <h1 className="text-3xl font-bold">Create New Tournament</h1>
          </div>
          <p className="text-slate-400">
            Set up your cricket auction tournament with custom rules and settings
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Basic Information */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <h2 className="text-xl font-bold mb-6">Basic Information</h2>
            
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Tournament Name *</Label>
                <Input
                  id="name"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., IPL 2025 Mega Auction"
                  className="mt-2"
                />
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Brief description of your tournament..."
                  className="mt-2"
                  rows={3}
                />
              </div>
              <div>
                <Label>Tournament Logo</Label>
                <div className="mt-2">
                  <ImageUpload
                    value={logoPreview || undefined}
                    onChange={(url) => setLogoPreview(url || null)}
                    folder="tournaments"
                    aspectRatio="square"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Auction Settings */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-6">
            <h2 className="text-xl font-bold mb-6">Auction Settings</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="basePurse">Base Purse per Team (₹) *</Label>
                <Input
                  id="basePurse"
                  type="number"
                  required
                  value={formData.basePurse}
                  onChange={(e) => setFormData({ ...formData, basePurse: parseInt(e.target.value) })}
                  className="mt-2"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Current: ₹{(formData.basePurse / 100000).toFixed(1)} Lakhs
                </p>
              </div>

              <div>
                <Label htmlFor="minBidIncrement">Minimum Bid Increment (₹) *</Label>
                <Input
                  id="minBidIncrement"
                  type="number"
                  required
                  value={formData.minBidIncrement}
                  onChange={(e) => setFormData({ ...formData, minBidIncrement: parseInt(e.target.value) })}
                  className="mt-2"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Current: ₹{(formData.minBidIncrement / 1000).toFixed(0)}K
                </p>
              </div>

              <div>
                <Label htmlFor="bidTimerSeconds">Bid Timer (seconds) *</Label>
                <Input
                  id="bidTimerSeconds"
                  type="number"
                  required
                  min="10"
                  max="120"
                  value={formData.bidTimerSeconds}
                  onChange={(e) => setFormData({ ...formData, bidTimerSeconds: parseInt(e.target.value) })}
                  className="mt-2"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Recommended: 30 seconds
                </p>
              </div>

              <div>
                <Label htmlFor="maxPlayersPerTeam">Max Players per Team *</Label>
                <Input
                  id="maxPlayersPerTeam"
                  type="number"
                  required
                  min="11"
                  max="25"
                  value={formData.maxPlayersPerTeam}
                  onChange={(e) => setFormData({ ...formData, maxPlayersPerTeam: parseInt(e.target.value) })}
                  className="mt-2"
                />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-4">
            <Link href="/dashboard">
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Tournament'}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}