"use client";

import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { X, Settings, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ImageUpload } from '@/components/ui/image-upload';
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
      basePrice?: number;
    };
    status?: string;
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

  const [formData, setFormData] = useState({
    name: currentSettings.name,
    description: currentSettings.description || '',
    logoUrl: currentSettings.logoUrl || '',
    basePurse: currentSettings.settings.basePurse,
    minBidIncrement: currentSettings.settings.minBidIncrement,
    maxPlayersPerTeam: currentSettings.settings.maxPlayersPerTeam,
    basePrice: currentSettings.settings.basePrice || 100000,
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
          maxPlayersPerTeam: formData.maxPlayersPerTeam,
          basePrice: formData.basePrice,
        },
      });

      toast.success('Tournament updated successfully!');
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
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full p-6 my-auto" onClick={(e) => e.stopPropagation()}>
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

        <div className="flex items-start gap-3 bg-blue-500/10 border border-blue-500/40 rounded-lg p-4 mb-6">
          <AlertTriangle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <p className="text-sm text-blue-200">
            These settings apply across the whole tournament. Changing the base purse updates
            every team&apos;s purse. Settings are locked while the auction is live — restart the
            auction to change them.
          </p>
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
              <Label>Tournament Logo</Label>
              <div className="mt-2">
                <ImageUpload
                  value={formData.logoUrl || undefined}
                  onChange={(url) => setFormData({ ...formData, logoUrl: url || '' })}
                  folder="tournaments"
                  aspectRatio="square"
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
                <Label htmlFor="basePrice">Base Player Price (₹) *</Label>
                <Input
                  id="basePrice"
                  type="number"
                  required
                  value={formData.basePrice}
                  onChange={(e) => setFormData({ ...formData, basePrice: parseInt(e.target.value) })}
                  className="mt-2"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Default: ₹{(formData.basePrice / 100000).toFixed(1)}L
                </p>
              </div>

              <div>
                <Label htmlFor="maxPlayersPerTeam">Max Players per Team *</Label>
                <Input
                  id="maxPlayersPerTeam"
                  type="number"
                  required
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
