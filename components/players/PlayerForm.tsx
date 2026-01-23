"use client";

import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

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
    role: 'All-Rounder' as 'Batter' | 'Bowler' | 'All-Rounder',
    battingBowlingHand: 'Right' as 'Right' | 'Left',
    jerseyNumber: undefined as number | undefined,
    basePrice: 150000,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await createPlayer({
        tournamentId,
        name: formData.name,
        phoneNumber: formData.phoneNumber || undefined,
        age: formData.age,
        role: formData.role,
        battingBowlingHand: formData.battingBowlingHand,
        jerseyNumber: formData.jerseyNumber,
        availability: { type: 'available' },
        basePrice: formData.basePrice,
      });

      toast.success('Player added successfully!');
      onClose();
    } catch (error) {
      toast.error('Failed to add player');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full p-6 my-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">Add New Player</h2>
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
                placeholder="e.g., Arjun Sharma"
                className="mt-2"
              />
            </div>

            <div>
              <Label htmlFor="phoneNumber">Phone Number</Label>
              <Input
                id="phoneNumber"
                value={formData.phoneNumber}
                onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                placeholder="e.g., 9876543210"
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
              <Select
                value={formData.role}
                onValueChange={(value) => setFormData({ ...formData, role: value as 'Batter' | 'Bowler' | 'All-Rounder' })}
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
              <Label htmlFor="battingHand">Batting/Bowling Hand *</Label>
              <Select
                value={formData.battingBowlingHand}
                onValueChange={(value) => setFormData({ ...formData, battingBowlingHand: value as 'Right' | 'Left' })}
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
                placeholder="e.g., 7"
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

            <div className="md:col-span-2">

            </div>
            
          </div>

          <div className="pt-4 flex gap-3">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? 'Adding...' : 'Add Player'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}