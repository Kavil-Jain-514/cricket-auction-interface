"use client";

import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { X, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

interface TournamentSettingsModalProps {
  tournamentId: Id<"tournaments">;
  currentSettings: {
    name: string;
    description?: string;
    logoUrl?: string;
    settings: {
      basePurse: number;
      minBidIncrement: number;
      bidTimerSeconds?: number;
      maxPlayersPerTeam: number;
    };
  };
  onClose: () => void;
}

export function TournamentSettingsModal({ 
  tournamentId, 
  currentSettings, 
  onClose 
}: TournamentSettingsModalProps) {
  const updateTournament = useMutation(api.tournaments.update);
  const [loading, setLoading] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(currentSettings.logoUrl || null);

  const [formData, setFormData] = useState({
    name: currentSettings.name,
    description: currentSettings.description || '',
    logoUrl: currentSettings.logoUrl || '',
    basePurse: currentSettings.settings.basePurse,
    minBidIncrement: currentSettings.settings.minBidIncrement,
    bidTimerSeconds: currentSettings.settings.bidTimerSeconds || 30,
    maxPlayersPerTeam: currentSettings.settings.maxPlayersPerTeam,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await updateTournament({
        id: tournamentId,
        name: formData.name,
        description: formData.description || undefined,
        logoUrl: formData.logoUrl || undefined,
        settings: {
          basePurse: formData.basePurse,
          minBidIncrement: formData.minBidIncrement,
          bidTimerSeconds: formData.bidTimerSeconds,
          maxPlayersPerTeam: formData.maxPlayersPerTeam,
        },
      });

      toast.success('Tournament settings updated!');
      onClose();
    } catch (error) {
      toast.error('Failed to update settings', { 
        description: (error as Error).message 
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full p-6 my-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Settings className="w-6 h-6 text-blue-500" />
            <h2 className="text-2xl font-bold">Tournament Settings</h2>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 hover:bg-slate-800 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-300 border-b border-slate-700 pb-2">
              Basic Information
            </h3>
            
            <div>
              <Label htmlFor="name">Tournament Name *</Label>
              <Input
                id="name"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., IPL 2026"
                className="mt-2"
              />
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Enter tournament description..."
                className="mt-2 min-h-20"
              />
            </div>

            <div>
              <Label htmlFor="logoUrl">Tournament Logo</Label>
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
                        <p className="text-xs text-slate-400">Click the trash icon to remove</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setLogoPreview(null);
                          setFormData({ ...formData, logoUrl: '' });
                        }}
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
                        const result = reader.result as string;
                        setLogoPreview(result);
                        setFormData({ ...formData, logoUrl: result });
                      };
                      reader.readAsDataURL(file);
                      toast.success('Logo uploaded successfully!');
                    }
                  }}
                />
              </div>
            </div>
          </div>

          {/* Auction Settings Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-300 border-b border-slate-700 pb-2">
              Auction Settings
            </h3>
            
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="basePurse">Base Purse per Team (₹) *</Label>
                <Input
                  id="basePurse"
                  type="number"
                  required
                  min="100000"
                  step="100000"
                  value={formData.basePurse}
                  onChange={(e) => setFormData({ ...formData, basePurse: parseInt(e.target.value) })}
                  className="mt-2"
                />
                <p className="text-xs text-slate-400 mt-1">
                  ₹{(formData.basePurse / 100000).toFixed(1)}L per team
                </p>
              </div>

              <div>
                <Label htmlFor="minBidIncrement">Minimum Bid Increment (₹) *</Label>
                <Input
                  id="minBidIncrement"
                  type="number"
                  required
                  min="5000"
                  step="5000"
                  value={formData.minBidIncrement}
                  onChange={(e) => setFormData({ ...formData, minBidIncrement: parseInt(e.target.value) })}
                  className="mt-2"
                />
                <p className="text-xs text-slate-400 mt-1">
                  ₹{(formData.minBidIncrement / 1000).toFixed(0)}K increment
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
                  Time for each bid round
                </p>
              </div>

              <div>
                <Label htmlFor="maxPlayersPerTeam">Max Players per Team *</Label>
                <Input
                  id="maxPlayersPerTeam"
                  type="number"
                  required
                  min="5"
                  max="25"
                  value={formData.maxPlayersPerTeam}
                  onChange={(e) => setFormData({ ...formData, maxPlayersPerTeam: parseInt(e.target.value) })}
                  className="mt-2"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Maximum squad size
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="pt-4 flex gap-3 border-t border-slate-700">
            <Button 
              type="button" 
              variant="outline" 
              onClick={onClose} 
              className="flex-1"
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={loading} 
              className="flex-1"
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
