"use client";

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Doc, Id } from '@/convex/_generated/dataModel';
import { getRoles, getRoleDisplay } from '@/lib/utils';
import { X, Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImageUpload } from '@/components/ui/image-upload';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/utils';
import { TeamColorPicker } from './TeamColorPicker';

interface TeamEditFormProps {
  team: Doc<"teams">;
  onClose: () => void;
  onSuccess: () => void;
}

export function TeamEditForm({ team, onClose, onSuccess }: TeamEditFormProps) {
  const updateTeam = useMutation(api.teams.update);
  const players = useQuery(api.players.listByTournament, { tournamentId: team.tournamentId });
  const teams = useQuery(api.teams.listByTournament, { tournamentId: team.tournamentId });
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: team.name,
    ownerName: team.ownerName,
    sponsorName: team.sponsorName || '',
    logoUrl: team.logoUrl || '',
    colorPrimary: team.colorPrimary,
    colorSecondary: team.colorSecondary,
    // Captain details
    captainPlayerId: (team.captainPlayerId || '') as string,
    captainName: team.captainName || '',
    captainPhotoUrl: team.captainPhotoUrl || '',
    captainAge: team.captainAge,
    captainRole: (team.captainRole || '') as '' | 'Batter' | 'Bowler' | 'All-Rounder',
    captainHand: (team.captainHand || '') as '' | 'Right' | 'Left',
  });

  // Players captaining OTHER teams can't be picked
  const takenCaptainIds = new Set(
    (teams ?? [])
      .filter((t) => t._id !== team._id)
      .flatMap((t) => (t.captainPlayerId ? [t.captainPlayerId] : [])),
  );
  const selectablePlayers = (players ?? []).filter((p) => !takenCaptainIds.has(p._id));
  const captainFromPlayer = formData.captainPlayerId !== '';

  const handleCaptainSelect = (value: string) => {
    if (value === 'manual') {
      setFormData({ ...formData, captainPlayerId: '' });
      return;
    }
    const player = players?.find((p) => p._id === value);
    if (!player) return;
    const primaryRole = getRoles(player.role)[0];
    setFormData({
      ...formData,
      captainPlayerId: value,
      // Preview of what the server will store (it re-derives these itself)
      captainName: player.name,
      captainPhotoUrl: player.photoUrl || '',
      captainAge: player.age,
      captainRole: (['Batter', 'Bowler', 'All-Rounder'].includes(primaryRole)
        ? primaryRole
        : '') as '' | 'Batter' | 'Bowler' | 'All-Rounder',
      captainHand: player.battingBowlingHand.includes('Right') ? 'Right' : 'Left',
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await updateTeam({
        id: team._id,
        name: formData.name,
        ownerName: formData.ownerName,
        sponsorName: formData.sponsorName || undefined,
        logoUrl: formData.logoUrl || undefined,
        colorPrimary: formData.colorPrimary,
        colorSecondary: formData.colorSecondary,
        // null clears a previously linked captain; undefined leaves it unchanged
        captainPlayerId: formData.captainPlayerId
          ? (formData.captainPlayerId as Id<"players">)
          : team.captainPlayerId
            ? null
            : undefined,
        captainName: formData.captainName || undefined,
        captainPhotoUrl: formData.captainPhotoUrl || undefined,
        captainAge: formData.captainAge,
        captainRole: formData.captainRole || undefined,
        captainHand: formData.captainHand || undefined,
      });

      toast.success('Team updated successfully!');
      onSuccess();
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update team'));
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-3xl w-full p-6 my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Edit Team</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Row 1: Team Name and Owner Name */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="name">Team Name *</Label>
              <Input
                id="name"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Mumbai Masters"
                className="mt-2"
              />
            </div>

            <div>
              <Label htmlFor="ownerName">Owner Name *</Label>
              <Input
                id="ownerName"
                required
                value={formData.ownerName}
                onChange={(e) => setFormData({ ...formData, ownerName: e.target.value })}
                placeholder="e.g., John Doe"
                className="mt-2"
              />
            </div>
          </div>

          {/* Row 2: Sponsor Name */}
          <div>
            <Label htmlFor="sponsorName">Sponsor Name (Optional)</Label>
            <Input
              id="sponsorName"
              value={formData.sponsorName}
              onChange={(e) => setFormData({ ...formData, sponsorName: e.target.value })}
              placeholder="e.g., ABC Company"
              className="mt-2"
            />
          </div>

          {/* Row 3: Logo and Colors side by side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <Label>Team Logo</Label>
              <div className="mt-2">
                <ImageUpload
                  value={formData.logoUrl}
                  onChange={(url) => setFormData({ ...formData, logoUrl: url || '' })}
                  folder="teams"
                  aspectRatio="square"
                />
              </div>
            </div>

            <TeamColorPicker
              primary={formData.colorPrimary}
              secondary={formData.colorSecondary}
              onChange={(colorPrimary, colorSecondary) =>
                setFormData({ ...formData, colorPrimary, colorSecondary })
              }
            />
          </div>

          {/* Captain Section */}
          <div className="border-t border-slate-700 pt-5">
            <div className="flex items-center gap-2 mb-4">
              <Crown className="w-5 h-5 text-yellow-500" />
              <h3 className="text-lg font-semibold">Captain Details (Optional)</h3>
            </div>

            {/* Captain from players */}
            <div className="mb-4">
              <Label>Select Captain from Players</Label>
              <Select
                value={formData.captainPlayerId || 'manual'}
                onValueChange={handleCaptainSelect}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Choose a player" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">None — enter details manually</SelectItem>
                  {selectablePlayers.map((player) => (
                    <SelectItem key={player._id} value={player._id}>
                      {player.name} ({getRoleDisplay(player.role)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {captainFromPlayer && (
                <p className="text-xs text-yellow-500/90 mt-2">
                  Captain details are filled from this player&apos;s profile. They&apos;ll get
                  a &quot;C&quot; tag in the players list.
                </p>
              )}
            </div>

            {/* Captain Row 1: Name and Age */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className="md:col-span-2">
                <Label htmlFor="captainName">Captain Name</Label>
                <Input
                  id="captainName"
                  value={formData.captainName}
                  onChange={(e) => setFormData({ ...formData, captainName: e.target.value })}
                  placeholder="e.g., Virat Kohli"
                  disabled={captainFromPlayer}
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="captainAge">Age</Label>
                <Input
                  id="captainAge"
                  type="number"
                  min="1"
                  value={formData.captainAge || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    captainAge: e.target.value ? parseInt(e.target.value) : undefined
                  })}
                  placeholder="e.g., 35"
                  disabled={captainFromPlayer}
                  className="mt-2"
                />
              </div>
            </div>

            {/* Captain Row 2: Role and Hand */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <Label>Role</Label>
                <Select
                  value={formData.captainRole}
                  onValueChange={(value) => setFormData({ ...formData, captainRole: value as 'Batter' | 'Bowler' | 'All-Rounder' })}
                  disabled={captainFromPlayer}
                >
                  <SelectTrigger className="mt-2">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Batter">Batter</SelectItem>
                    <SelectItem value="Bowler">Bowler</SelectItem>
                    <SelectItem value="All-Rounder">All-Rounder</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Batting/Bowling Hand</Label>
                <Select
                  value={formData.captainHand}
                  onValueChange={(value) => setFormData({ ...formData, captainHand: value as 'Right' | 'Left' })}
                  disabled={captainFromPlayer}
                >
                  <SelectTrigger className="mt-2">
                    <SelectValue placeholder="Select hand" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Right">Right-handed</SelectItem>
                    <SelectItem value="Left">Left-handed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Captain Photo — from the player's profile when one is selected */}
            {!captainFromPlayer && (
              <div>
                <Label>Captain Photo</Label>
                <div className="mt-2">
                  <ImageUpload
                    value={formData.captainPhotoUrl}
                    onChange={(url) => setFormData({ ...formData, captainPhotoUrl: url || '' })}
                    folder="players"
                    aspectRatio="square"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="pt-4 flex gap-3">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? 'Updating...' : 'Update Team'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}