"use client";

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { X } from 'lucide-react';
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
import { PLAYER_ROLES } from '@/lib/utils';

interface PlayerFormProps {
  tournamentId: Id<"tournaments">;
  onClose: () => void;
}

export function PlayerForm({ tournamentId, onClose }: PlayerFormProps) {
  const createPlayer = useMutation(api.players.create);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    phoneNumber: '',
    age: 24,
    role: ['All-Rounder'] as string[],
    battingBowlingHand: 'Right-handed' as 'Right-handed' | 'Left-handed',
    tshirtSize: 'L' as 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL' | '3XL' | '4XL',
    jerseyNumber: undefined as number | undefined,
    basePrice: undefined as number | undefined,
    photoUrl: '',
  });

  const tournament = useQuery(api.tournaments.getById, { id: tournamentId });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Name validation
    if (!formData.name.trim()) {
      newErrors.name = 'Player name is required';
    } else if (formData.name.trim().length < 2) {
      newErrors.name = 'Name must be at least 2 characters';
    } else if (formData.name.trim().length > 50) {
      newErrors.name = 'Name must be less than 50 characters';
    }

    // Age validation
    if (!formData.age || formData.age < 15) {
      newErrors.age = 'Age must be at least 15';
    } else if (formData.age > 65) {
      newErrors.age = 'Age must be less than 65';
    }

    // Phone validation (optional but if provided, validate format)
    if (formData.phoneNumber && !/^[0-9]{10}$/.test(formData.phoneNumber)) {
      newErrors.phoneNumber = 'Phone number must be 10 digits';
    }

    // Base price validation (optional)
    if (formData.basePrice !== undefined) {
      if (formData.basePrice < 50000) {
        newErrors.basePrice = 'Base price must be at least ₹50,000';
      } else if (formData.basePrice > 50000000) {
        newErrors.basePrice = 'Base price cannot exceed ₹5 Crore';
      }
    }

    // Jersey number validation (optional)
    if (formData.jerseyNumber !== undefined) {
      if (formData.jerseyNumber < 1 || formData.jerseyNumber > 99) {
        newErrors.jerseyNumber = 'Jersey number must be between 1 and 99';
      }
    }

    setErrors(newErrors);

    // Show first error as toast
    const firstError = Object.values(newErrors)[0];
    if (firstError) {
      toast.error(firstError);
    }

    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      await createPlayer({
        tournamentId,
        name: formData.name,
        phoneNumber: formData.phoneNumber || undefined,
        age: formData.age,
        role: formData.role,
        battingBowlingHand: formData.battingBowlingHand,
        tshirtSize: formData.tshirtSize,
        jerseyNumber: formData.jerseyNumber,
        basePrice: formData.basePrice,
        photoUrl: formData.photoUrl || undefined,
      });

      toast.success('Player added successfully!');
      onClose();
    } catch (error) {
      toast.error((error as Error)?.message || 'Failed to add player');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto ipad-scroll">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-4xl w-full p-4 sm:p-6 my-4 sm:my-8">
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <h2 className="text-xl sm:text-2xl font-bold">Add New Player</h2>
          <button onClick={onClose} className="p-2.5 hover:bg-slate-800 rounded-lg transition touch-target">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
          {/* Row 1: Name and Phone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <Label htmlFor="name">Player Name *</Label>
              <Input
                id="name"
                required
                value={formData.name}
                onChange={(e) => {
                  setFormData({ ...formData, name: e.target.value });
                  if (errors.name) setErrors({ ...errors, name: '' });
                }}
                placeholder="e.g., Arjun Sharma"
                className={`mt-2 h-11 sm:h-12 text-base ${errors.name ? 'border-red-500' : ''}`}
              />
              {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
            </div>

            <div>
              <Label htmlFor="phoneNumber">Phone Number</Label>
              <Input
                id="phoneNumber"
                value={formData.phoneNumber}
                onChange={(e) => {
                  setFormData({ ...formData, phoneNumber: e.target.value });
                  if (errors.phoneNumber) setErrors({ ...errors, phoneNumber: '' });
                }}
                placeholder="e.g., 9876543210"
                className={`mt-2 h-11 sm:h-12 text-base ${errors.phoneNumber ? 'border-red-500' : ''}`}
              />
              {errors.phoneNumber && <p className="text-red-400 text-xs mt-1">{errors.phoneNumber}</p>}
            </div>
          </div>

          {/* Row 2: Age, Role, Hand, T-Shirt Size, Jersey */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
            <div>
              <Label htmlFor="age">Age *</Label>
              <Input
                id="age"
                type="number"
                required
                min="15"
                max="65"
                value={formData.age}
                onChange={(e) => {
                  setFormData({ ...formData, age: parseInt(e.target.value) || 0 });
                  if (errors.age) setErrors({ ...errors, age: '' });
                }}
                className={`mt-2 h-11 sm:h-12 text-base ${errors.age ? 'border-red-500' : ''}`}
              />
              {errors.age && <p className="text-red-400 text-xs mt-1">{errors.age}</p>}
            </div>

            <div>
              <Label>Role(s) *</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {PLAYER_ROLES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      setFormData(prev => ({
                        ...prev,
                        role: prev.role.includes(r)
                          ? prev.role.filter(x => x !== r)
                          : [...prev.role, r],
                      }));
                    }}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition border ${formData.role.includes(r)
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
                      }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              {formData.role.length === 0 && <p className="text-red-400 text-xs mt-1">Select at least one role</p>}
            </div>

            <div className="col-span-2 sm:col-span-1">
              <Label htmlFor="battingHand">Batting/Bowling *</Label>
              <Select
                value={formData.battingBowlingHand}
                onValueChange={(value) => setFormData({ ...formData, battingBowlingHand: value as 'Right-handed' | 'Left-handed' })}
              >
                <SelectTrigger className="mt-2 h-11 sm:h-12 text-base">
                  <SelectValue placeholder="Select hand" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Right-handed" className="py-3">Right-handed</SelectItem>
                  <SelectItem value="Left-handed" className="py-3">Left-handed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="tshirtSize">T-Shirt Size</Label>
              <Select
                value={formData.tshirtSize}
                onValueChange={(value) => setFormData({ ...formData, tshirtSize: value as 'S' | 'M' | 'L' | 'XL' | 'XXL' | '3XL' | '4XL' })}
              >
                <SelectTrigger className="mt-2 h-11 sm:h-12 text-base">
                  <SelectValue placeholder="Size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="S" className="py-3">S</SelectItem>
                  <SelectItem value="M" className="py-3">M</SelectItem>
                  <SelectItem value="L" className="py-3">L</SelectItem>
                  <SelectItem value="XL" className="py-3">XL</SelectItem>
                  <SelectItem value="XXL" className="py-3">XXL</SelectItem>
                  <SelectItem value="3XL" className="py-3">3XL</SelectItem>
                  <SelectItem value="4XL" className="py-3">4XL</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="jerseyNumber">Jersey #</Label>
              <Input
                id="jerseyNumber"
                type="number"
                min="1"
                max="99"
                value={formData.jerseyNumber || ''}
                onChange={(e) => {
                  setFormData({
                    ...formData,
                    jerseyNumber: e.target.value ? parseInt(e.target.value) : undefined
                  });
                  if (errors.jerseyNumber) setErrors({ ...errors, jerseyNumber: '' });
                }}
                placeholder="e.g., 7"
                className={`mt-2 h-11 sm:h-12 text-base ${errors.jerseyNumber ? 'border-red-500' : ''}`}
              />
              {errors.jerseyNumber && <p className="text-red-400 text-xs mt-1">{errors.jerseyNumber}</p>}
            </div>
          </div>

          {/* Row 3: Base Price and Photo side by side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="basePrice">Base Price Override (₹)</Label>
                <Input
                  id="basePrice"
                  type="number"
                  min="50000"
                  step="25000"
                  value={formData.basePrice || ''}
                  placeholder={`Default: ₹${((tournament?.settings?.basePrice ?? 100000) / 100000).toFixed(1)}L`}
                  onChange={(e) => {
                    setFormData({ ...formData, basePrice: e.target.value ? parseInt(e.target.value) : undefined });
                    if (errors.basePrice) setErrors({ ...errors, basePrice: '' });
                  }}
                  className={`mt-2 h-11 sm:h-12 text-base ${errors.basePrice ? 'border-red-500' : ''}`}
                />
                {errors.basePrice ? (
                  <p className="text-red-400 text-xs mt-1">{errors.basePrice}</p>
                ) : (
                  <p className="text-xs text-slate-400 mt-1">
                    {formData.basePrice ? `Overridden: ₹${(formData.basePrice / 100000).toFixed(2)}L` : 'Leave empty to inherit from tournament'}
                  </p>
                )}
              </div>
            </div>

            <div>
              <Label>Player Photo</Label>
              <div className="mt-2">
                <ImageUpload
                  value={formData.photoUrl}
                  onChange={(url) => setFormData({ ...formData, photoUrl: url || '' })}
                  folder="players"
                  aspectRatio="square"
                />
              </div>
            </div>
          </div>

          <div className="pt-4 flex flex-col-reverse sm:flex-row gap-3">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 h-12 text-base">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="flex-1 h-12 text-base">
              {loading ? 'Adding...' : 'Add Player'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}