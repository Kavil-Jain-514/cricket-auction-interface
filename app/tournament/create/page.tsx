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
                <Label htmlFor="logoUrl">Upload Logo</Label>
                <div className="mt-2">
                  {logoPreview ? (
                    <div className="relative w-full">
                      <div className="flex items-center gap-4 p-4 border border-slate-600 rounded-xl bg-slate-800/30">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img 
                          src={logoPreview} 
                          alt="Logo preview" 
                          className="w-20 h-20 rounded-lg object-cover border border-slate-500"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-white">Logo uploaded</p>
                          <p className="text-xs text-slate-400">Click below to change</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setLogoPreview(null)}
                          className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded-lg transition-colors"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <label 
                      htmlFor="logoUrl" 
                      className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-600 rounded-xl cursor-pointer hover:border-blue-500 hover:bg-slate-800/50 transition-all group"
                    >
                      <div className="flex flex-col items-center justify-center pt-5 pb-6">
                        <svg className="w-8 h-8 mb-2 text-slate-400 group-hover:text-blue-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <p className="text-sm text-slate-400 group-hover:text-slate-300">
                          <span className="font-semibold text-blue-400">Click to upload</span> or drag and drop
                        </p>
                        <p className="text-xs text-slate-500 mt-1">PNG, JPG, SVG (max 2MB)</p>
                      </div>
                    </label>
                  )}
                  <input
                    id="logoUrl"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          setLogoPreview(reader.result as string);
                        };
                        reader.readAsDataURL(file);
                        toast.success('Logo uploaded successfully!');
                      }
                    }}
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