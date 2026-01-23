"use client";

import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface TeamFormProps {
  tournamentId: Id<"tournaments">;
  onClose: () => void;
}

const PRESET_COLORS = [
  { primary: '#3B82F6', secondary: '#1D4ED8', name: 'Blue' },
  { primary: '#EF4444', secondary: '#DC2626', name: 'Red' },
  { primary: '#10B981', secondary: '#059669', name: 'Green' },
  { primary: '#F59E0B', secondary: '#D97706', name: 'Orange' },
  { primary: '#8B5CF6', secondary: '#7C3AED', name: 'Purple' },
  { primary: '#EC4899', secondary: '#DB2777', name: 'Pink' },
];

export function TeamForm({ tournamentId, onClose }: TeamFormProps) {
  const createTeam = useMutation(api.teams.create);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    ownerName: '',
    sponsorName: '',
    colorPrimary: PRESET_COLORS[0].primary,
    colorSecondary: PRESET_COLORS[0].secondary,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await createTeam({
        tournamentId,
        name: formData.name,
        ownerName: formData.ownerName,
        sponsorName: formData.sponsorName || undefined,
        colorPrimary: formData.colorPrimary,
        colorSecondary: formData.colorSecondary,
      });

      toast.success('Team created successfully!');
      onClose();
    } catch (error) {
      toast.error('Failed to create team');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Add New Team</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
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

          <div>
            <Label>Team Color</Label>
            <div className="grid grid-cols-3 gap-3 mt-2">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color.name}
                  type="button"
                  onClick={() => setFormData({
                    ...formData,
                    colorPrimary: color.primary,
                    colorSecondary: color.secondary,
                  })}
                  className={`p-4 rounded-lg border-2 transition ${
                    formData.colorPrimary === color.primary
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

          <div className="pt-4 flex gap-3">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? 'Creating...' : 'Create Team'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}