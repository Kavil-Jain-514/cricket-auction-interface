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
  const [errors, setErrors] = useState<Record<string, string>>({});

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

  const validateStep1 = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Team name validation
    if (!formData.name.trim()) {
      newErrors.name = 'Team name is required';
    } else if (formData.name.trim().length < 2) {
      newErrors.name = 'Team name must be at least 2 characters';
    } else if (formData.name.trim().length > 30) {
      newErrors.name = 'Team name must be less than 30 characters';
    }

    // Owner name validation
    if (!formData.ownerName.trim()) {
      newErrors.ownerName = 'Owner name is required';
    } else if (formData.ownerName.trim().length < 2) {
      newErrors.ownerName = 'Owner name must be at least 2 characters';
    }

    setErrors(newErrors);

    // Show first error as toast
    const firstError = Object.values(newErrors)[0];
    if (firstError) {
      toast.error(firstError);
      return false;
    }

    return true;
  };

  const validateStep2 = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Captain age validation (only if captain name is provided)
    if (formData.captainName && formData.captainAge !== undefined) {
      if (formData.captainAge < 15 || formData.captainAge > 65) {
        newErrors.captainAge = 'Captain age must be between 15 and 65';
      }
    }

    setErrors(newErrors);

    const firstError = Object.values(newErrors)[0];
    if (firstError) {
      toast.error(firstError);
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateStep2()) {
      return;
    }

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
      toast.error((error as Error)?.message || 'Failed to create team');
      console.error(error);
    } finally {
      setLoading(false);
    }
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
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-3xl w-full p-4 sm:p-6 my-4 sm:my-8 max-h-[95vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <h2 className="text-xl sm:text-2xl font-bold">Add New Team</h2>
          <button onClick={onClose} className="p-2.5 sm:p-2 hover:bg-slate-800 rounded-lg transition touch-target min-h-11 min-w-11 flex items-center justify-center">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2 sm:gap-4 mb-6 sm:mb-8">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-bold transition-all text-sm sm:text-base ${
              step === 1 
                ? 'bg-blue-600 text-white' 
                : 'bg-green-600 text-white'
            }`}>
              {step > 1 ? <Check className="w-4 h-4 sm:w-5 sm:h-5" /> : '1'}
            </div>
            <span className={`font-medium text-sm sm:text-base ${step === 1 ? 'text-white' : 'text-slate-400'}`}>
              <span className="hidden xs:inline">Team Details</span>
              <span className="xs:hidden">Team</span>
            </span>
          </div>
          
          <div className="w-8 sm:w-16 h-0.5 bg-slate-700">
            <div className={`h-full bg-blue-600 transition-all ${step === 2 ? 'w-full' : 'w-0'}`} />
          </div>
          
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-bold transition-all text-sm sm:text-base ${
              step === 2 
                ? 'bg-blue-600 text-white' 
                : 'bg-slate-700 text-slate-400'
            }`}>
              2
            </div>
            <span className={`font-medium text-sm sm:text-base ${step === 2 ? 'text-white' : 'text-slate-400'}`}>
              <span className="hidden xs:inline">Captain Details</span>
              <span className="xs:hidden">Captain</span>
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
                      onChange={(e) => {
                        setFormData({ ...formData, name: e.target.value });
                        if (errors.name) setErrors({ ...errors, name: '' });
                      }}
                      placeholder="e.g., Mumbai Masters"
                      className={`mt-2 ${errors.name ? 'border-red-500' : ''}`}
                    />
                    {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
                  </div>

                  <div>
                    <Label htmlFor="ownerName">Owner Name *</Label>
                    <Input
                      id="ownerName"
                      required
                      value={formData.ownerName}
                      onChange={(e) => {
                        setFormData({ ...formData, ownerName: e.target.value });
                        if (errors.ownerName) setErrors({ ...errors, ownerName: '' });
                      }}
                      placeholder="e.g., John Doe"
                      className={`mt-2 ${errors.ownerName ? 'border-red-500' : ''}`}
                    />
                    {errors.ownerName && <p className="text-red-400 text-xs mt-1">{errors.ownerName}</p>}
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
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
                    <div className="grid grid-cols-4 sm:grid-cols-3 gap-2 mt-2">
                      {PRESET_COLORS.map((color) => (
                        <button
                          key={color.name}
                          type="button"
                          onClick={() => setFormData({
                            ...formData,
                            colorPrimary: color.primary,
                            colorSecondary: color.secondary,
                          })}
                          className={`p-2.5 sm:p-3 rounded-lg border-2 transition min-h-11 touch-target ${
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
                <div className="pt-4 sm:pt-6 flex flex-col-reverse sm:flex-row gap-3">
                  <Button type="button" variant="outline" onClick={onClose} className="flex-1 min-h-11 touch-target">
                    Cancel
                  </Button>
                  <Button type="button" onClick={handleNext} className="flex-1 min-h-11 touch-target">
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
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-2">
                    <Label htmlFor="captainName">Captain Name</Label>
                    <Input
                      id="captainName"
                      value={formData.captainName}
                      onChange={(e) => setFormData({ ...formData, captainName: e.target.value })}
                      placeholder="e.g., Virat Kohli"
                      className="mt-2 min-h-11"
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
                      className="mt-2 min-h-11"
                    />
                  </div>
                </div>

                {/* Captain Row 2: Role and Hand */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label>Role</Label>
                    <Select
                      value={formData.captainRole}
                      onValueChange={(value) => setFormData({ ...formData, captainRole: value as 'Batter' | 'Bowler' | 'All-Rounder' })}
                    >
                      <SelectTrigger className="mt-2 min-h-11">
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
                      <SelectTrigger className="mt-2 min-h-11">
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
                <div className="pt-4 sm:pt-6 flex flex-col-reverse sm:flex-row gap-3">
                  <Button type="button" variant="outline" onClick={handleBack} className="flex-1 min-h-11 touch-target">
                    <ChevronLeft className="w-4 h-4 mr-2" />
                    Back
                  </Button>
                  <Button type="submit" disabled={loading} className="flex-1 min-h-11 touch-target">
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