"use client";

import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Doc } from '@/convex/_generated/dataModel';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ImageUpload } from '@/components/ui/image-upload';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface PlayerEditFormProps {
  player: Doc<"players">;
  onClose: () => void;
  onSuccess: () => void;
}

export function PlayerEditForm({ player, onClose, onSuccess }: PlayerEditFormProps) {
  const updatePlayer = useMutation(api.players.update);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: player.name,
    phoneNumber: player.phoneNumber || '',
    age: player.age,
    role: player.role,
    battingBowlingHand: player.battingBowlingHand,
    tshirtSize: player.tshirtSize || 'L',
    jerseyNumber: player.jerseyNumber,
    basePrice: player.basePrice,
    photoUrl: player.photoUrl || '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Normalize role to handle legacy data
    const normalizedRole = formData.role === 'All Rounder' ? 'All-Rounder' : formData.role;

    // Normalize hand to handle legacy data
    let normalizedHand = formData.battingBowlingHand;
    if (normalizedHand === 'Right') normalizedHand = 'Right-handed';
    if (normalizedHand === 'Left') normalizedHand = 'Left-handed';

    try {
      await updatePlayer({
        id: player._id,
        name: formData.name,
        phoneNumber: formData.phoneNumber || undefined,
        age: formData.age,
        role: normalizedRole as 'Batter' | 'Bowler' | 'All-Rounder',
        battingBowlingHand: normalizedHand as 'Right-handed' | 'Left-handed',
        tshirtSize: formData.tshirtSize as 'S' | 'M' | 'L' | 'XL' | 'XXL' | '3XL' | '4XL',
        jerseyNumber: formData.jerseyNumber,
        basePrice: formData.basePrice,
        photoUrl: formData.photoUrl || undefined,
      });

      toast.success('Player updated successfully!');
      onSuccess();
      onClose();
    } catch (error) {
      toast.error((error as Error)?.message || 'Failed to update player');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto ipad-scroll">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-4xl w-full p-4 sm:p-6 my-4 sm:my-8">
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <h2 className="text-xl sm:text-2xl font-bold">Edit Player</h2>
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
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Arjun Sharma"
                className="mt-2 h-11 sm:h-12 text-base"
              />
            </div>

            <div>
              <Label htmlFor="phoneNumber">Phone Number</Label>
              <Input
                id="phoneNumber"
                value={formData.phoneNumber || ''}
                onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                placeholder="e.g., 9876543210"
                className="mt-2 h-11 sm:h-12 text-base"
              />
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
                onChange={(e) => setFormData({ ...formData, age: parseInt(e.target.value) || 0 })}
                className="mt-2 h-11 sm:h-12 text-base"
              />
            </div>

            <div>
              <Label htmlFor="role">Role *</Label>
              <Select
                value={formData.role}
                onValueChange={(value) => setFormData({ ...formData, role: value as 'Batter' | 'Bowler' | 'All-Rounder' })}
              >
                <SelectTrigger className="mt-2 h-11 sm:h-12 text-base">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Batter" className="py-3">Batter</SelectItem>
                  <SelectItem value="Bowler" className="py-3">Bowler</SelectItem>
                  <SelectItem value="All-Rounder" className="py-3">All-Rounder</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 sm:col-span-1">
              <Label htmlFor="battingBowlingHand">Batting/Bowling *</Label>
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
                }}
                placeholder="e.g., 7"
                className="mt-2 h-11 sm:h-12 text-base"
              />
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
                  placeholder="Inherit from tournament"
                  onChange={(e) => setFormData({ ...formData, basePrice: e.target.value ? parseInt(e.target.value) : undefined })}
                  className="mt-2 h-11 sm:h-12 text-base"
                />
                <p className="text-xs text-slate-400 mt-1">
                  {formData.basePrice ? `Overridden: ₹${(formData.basePrice / 100000).toFixed(2)}L` : 'Leaving empty inherits from tournament'}
                </p>
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
              {loading ? 'Updating...' : 'Update Player'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}