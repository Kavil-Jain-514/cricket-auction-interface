"use client";

import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Doc } from '@/convex/_generated/dataModel';
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

interface TeamEditFormProps {
  team: Doc<"teams">;
  onClose: () => void;
  onSuccess: () => void;
}

const PRESET_COLORS = [
  { primary: '#3B82F6', secondary: '#1D4ED8', name: 'Blue' },
  { primary: '#EF4444', secondary: '#DC2626', name: 'Red' },
  { primary: '#10B981', secondary: '#059669', name: 'Green' },
  { primary: '#F59E0B', secondary: '#D97706', name: 'Orange' },
  { primary: '#8B5CF6', secondary: '#7C3AED', name: 'Purple' },
  { primary: '#EC4899', secondary: '#DB2777', name: 'Pink' },
  { primary: '#14B8A6', secondary: '#0D9488', name: 'Teal' },
  { primary: '#F97316', secondary: '#EA580C', name: 'Amber' },
  { primary: '#6366F1', secondary: '#4F46E5', name: 'Indigo' },
];

export function TeamEditForm({ team, onClose, onSuccess }: TeamEditFormProps) {
  const updateTeam = useMutation(api.teams.update);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: team.name,
    ownerName: team.ownerName,
    sponsorName: team.sponsorName || '',
    logoUrl: team.logoUrl || '',
    colorPrimary: team.colorPrimary,
    colorSecondary: team.colorSecondary,
    // Captain details
    captainName: team.captainName || '',
    captainPhotoUrl: team.captainPhotoUrl || '',
    captainAge: team.captainAge,
    captainRole: (team.captainRole || '') as '' | 'Batter' | 'Bowler' | 'All-Rounder',
    captainHand: (team.captainHand || '') as '' | 'Right' | 'Left',
  });

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

            <div>
              <Label>Team Color</Label>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color.name}
                    type="button"
                    onClick={() => setFormData({
                      ...formData,
                      colorPrimary: color.primary,
                      colorSecondary: color.secondary,
                    })}
                    className={`p-3 rounded-lg border-2 transition ${formData.colorPrimary === color.primary
                      ? 'border-white'
                      : 'border-transparent hover:border-slate-600'
                      }`}
                    style={{
                      background: `linear-gradient(135deg, ${color.primary}, ${color.secondary})`
                    }}
                  >
                    <span className="text-xs font-semibold text-white drop-shadow">
                      {color.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Captain Section */}
          <div className="border-t border-slate-700 pt-5">
            <div className="flex items-center gap-2 mb-4">
              <Crown className="w-5 h-5 text-yellow-500" />
              <h3 className="text-lg font-semibold">Captain Details (Optional)</h3>
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

            {/* Captain Photo */}
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