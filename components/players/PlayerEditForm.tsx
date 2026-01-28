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
    jerseyNumber: player.jerseyNumber,
    basePrice: player.basePrice,
    availability: player.availability,
    photoUrl: player.photoUrl || '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await updatePlayer({
        id: player._id,
        name: formData.name,
        phoneNumber: formData.phoneNumber || undefined,
        age: formData.age,
        role: formData.role,
        battingBowlingHand: formData.battingBowlingHand,
        jerseyNumber: formData.jerseyNumber,
        basePrice: formData.basePrice,
        availability: formData.availability,
        photoUrl: formData.photoUrl || undefined,
      });

      toast.success('Player updated successfully!');
      onSuccess();
      onClose();
    } catch (error) {
      toast.error(error?.message || 'Failed to update player');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full p-6 my-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Edit Player</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="name">Player Name *</Label>
              <Input
                id="name"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="mt-2"
              />
            </div>

            <div>
              <Label htmlFor="phoneNumber">Phone Number</Label>
              <Input
                id="phoneNumber"
                value={formData.phoneNumber}
                onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                className="mt-2"
              />
            </div>

            <div>
              <Label htmlFor="age">Age *</Label>
              <Input
                id="age"
                type="number"
                required
                min="15"
                max="50"
                value={formData.age}
                onChange={(e) => setFormData({ ...formData, age: parseInt(e.target.value) })}
                className="mt-2"
              />
            </div>

            <div>
              <Label htmlFor="role">Role *</Label>
              <select
                id="role"
                required
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value as 'Batter' | 'Bowler' | 'All-Rounder' })}
                className="mt-2 w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="Batter">Batter</option>
                <option value="Bowler">Bowler</option>
                <option value="All-Rounder">All-Rounder</option>
                <option value="Wicket-Keeper">Wicket-Keeper</option>
              </select>
            </div>

            <div>
              <Label htmlFor="battingBowlingHand">Batting/Bowling Hand *</Label>
              <select
                id="battingBowlingHand"
                required
                value={formData.battingBowlingHand}
                onChange={(e) => setFormData({ ...formData, battingBowlingHand: e.target.value as 'Right-handed' | 'Left-handed' })}
                className="mt-2 w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="Right-handed">Right-handed</option>
                <option value="Left-handed">Left-handed</option>
              </select>
            </div>


            <div>
              <Label htmlFor="jerseyNumber">Jersey Number</Label>
              <Input
                id="jerseyNumber"
                type="number"
                min="1"
                max="99"
                value={formData.jerseyNumber || ''}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  jerseyNumber: e.target.value ? parseInt(e.target.value) : undefined 
                })}
                className="mt-2"
              />
            </div>

            <div className="md:col-span-2">
              <Label htmlFor="basePrice">Base Price (₹) *</Label>
              <Input
                id="basePrice"
                type="number"
                required
                min="50000"
                step="25000"
                value={formData.basePrice}
                onChange={(e) => setFormData({ ...formData, basePrice: parseInt(e.target.value) })}
                className="mt-2"
              />
              <p className="text-xs text-slate-400 mt-1">
                Current: ₹{(formData.basePrice / 100000).toFixed(2)}L
              </p>
            </div>
          </div>

          <div>
              <Label htmlFor="photoUrl">Photo URL</Label>
              <Input
                id="photoUrl"
                value={formData.photoUrl}
                onChange={(e) => setFormData({ ...formData, photoUrl: e.target.value })}
                placeholder="e.g., https://example.com/photo.jpg"
                className="mt-2"
              />
            </div>

          <div className="pt-4 flex gap-3">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? 'Updating...' : 'Update Player'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}