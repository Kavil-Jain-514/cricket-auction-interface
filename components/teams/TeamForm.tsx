"use client";

import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { X, Crown, Users, ChevronRight, ChevronLeft, Check } from 'lucide-react';
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
import { motion, AnimatePresence } from 'framer-motion';

interface TeamFormProps {
  tournamentId: Id<"tournaments">;
  onClose: () => void;
}

const PRESET_COLORS = [
  { primary: '#3B82F6', secondary: '#1D4ED8', name: 'Blue' },
  { primary: '#EF4444', secondary: '#DC2626', name: 'Red' },
  { primary: '#8B5CF6', secondary: '#7C3AED', name: 'Purple' },
  { primary: '#14B8A6', secondary: '#0D9488', name: 'Teal' },
  { primary: '#F97316', secondary: '#EA580C', name: 'Amber' },
  { primary: '#FACC15', secondary: '#EAB308', name: 'Yellow' },
  { primary: '#78716C', secondary: '#57534E', name: 'Stone Gray' },
  { primary: '#FFF7E6', secondary: '#F3E8D0', name: 'Creame' },
  { primary: '#A855F7', secondary: '#9333EA', name: 'Violet' },
  { primary: '#800000', secondary: '#5A0000', name: 'Maroon' },
];

export function TeamForm({ tournamentId, onClose }: TeamFormProps) {
  const createTeam = useMutation(api.teams.create);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  const [formData, setFormData] = useState({
    name: '',
    ownerName: '',
    sponsorName: '',
    logoUrl: '',
    colorPrimary: PRESET_COLORS[0].primary,
    colorSecondary: PRESET_COLORS[0].secondary,
    // Captain details
    captainName: '',
    captainPhotoUrl: '',
    captainAge: undefined as number | undefined,
    captainRole: '' as '' | 'Batter' | 'Bowler' | 'All-Rounder',
    captainHand: '' as '' | 'Right' | 'Left',
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
        captainName: formData.captainName || undefined,
        captainPhotoUrl: formData.captainPhotoUrl || undefined,
        captainAge: formData.captainAge,
        captainRole: formData.captainRole || undefined,
        captainHand: formData.captainHand || undefined,
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

  const validateStep1 = () => {
    if (!formData.name.trim()) {
      toast.error('Team name is required');
      return false;
    }
    if (!formData.ownerName.trim()) {
      toast.error('Owner name is required');
      return false;
    }
    return true;
  };

  const handleNext = () => {
    if (validateStep1()) {
      setStep(2);
    }
  };

  const handleBack = () => {
    setStep(1);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-3xl w-full p-6 my-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Add New Team</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-4 mb-8">
          <div className="flex items-center gap-2">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all ${
              step === 1 
                ? 'bg-blue-600 text-white' 
                : 'bg-green-600 text-white'
            }`}>
              {step > 1 ? <Check className="w-5 h-5" /> : '1'}
            </div>
            <span className={`font-medium ${step === 1 ? 'text-white' : 'text-slate-400'}`}>
              Team Details
            </span>
          </div>
          
          <div className="w-16 h-0.5 bg-slate-700">
            <div className={`h-full bg-blue-600 transition-all ${step === 2 ? 'w-full' : 'w-0'}`} />
          </div>
          
          <div className="flex items-center gap-2">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all ${
              step === 2 
                ? 'bg-blue-600 text-white' 
                : 'bg-slate-700 text-slate-400'
            }`}>
              2
            </div>
            <span className={`font-medium ${step === 2 ? 'text-white' : 'text-slate-400'}`}>
              Captain Details
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <AnimatePresence mode="wait">
            {step === 1 ? (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="space-y-5"
              >
                {/* Step 1: Team Details */}
                <div className="flex items-center gap-2 mb-4">
                  <Users className="w-5 h-5 text-blue-500" />
                  <h3 className="text-lg font-semibold">Team Information</h3>
                </div>

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
                          className={`p-3 rounded-lg border-2 transition ${
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
                </div>

                {/* Step 1 Actions */}
                <div className="pt-6 flex gap-3">
                  <Button type="button" variant="outline" onClick={onClose} className="flex-1">
                    Cancel
                  </Button>
                  <Button type="button" onClick={handleNext} className="flex-1">
                    Next: Captain Details
                    <ChevronRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
                className="space-y-5"
              >
                {/* Step 2: Captain Details */}
                <div className="flex items-center gap-2 mb-4">
                  <Crown className="w-5 h-5 text-yellow-500" />
                  <h3 className="text-lg font-semibold">Captain Information (Optional)</h3>
                </div>

                <p className="text-sm text-slate-400 -mt-2 mb-4">
                  Add details about your team captain. You can skip this step and add later.
                </p>

                {/* Captain Row 1: Name and Age */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                      min="15"
                      max="50"
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                      className="max-w-48"
                    />
                  </div>
                </div>

                {/* Step 2 Actions */}
                <div className="pt-6 flex gap-3">
                  <Button type="button" variant="outline" onClick={handleBack} className="flex-1">
                    <ChevronLeft className="w-4 h-4 mr-2" />
                    Back
                  </Button>
                  <Button type="submit" disabled={loading} className="flex-1">
                    {loading ? 'Creating...' : 'Create Team'}
                    <Check className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </form>
      </div>
    </div>
  );
}