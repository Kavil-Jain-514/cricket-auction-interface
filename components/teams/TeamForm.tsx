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
  { primary: '#14B8A6', secondary: '#0D9488', name: 'Teal' },
  { primary: '#F97316', secondary: '#EA580C', name: 'Amber' },
  { primary: '#6366F1', secondary: '#4F46E5', name: 'Indigo' },
];

export function TeamForm({ tournamentId, onClose }: TeamFormProps) {
  const createTeam = useMutation(api.teams.create);
  const [loading, setLoading] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    ownerName: '',
    sponsorName: '',
    logoUrl: '',
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
        logoUrl: formData.logoUrl || undefined,
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
              <Label htmlFor="logoUrl">Team Logo</Label>
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