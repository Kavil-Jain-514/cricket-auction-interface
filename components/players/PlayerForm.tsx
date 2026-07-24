"use client";

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { toast } from 'sonner';
import {
  PlayerFormModal,
  PlayerFormFields,
  type PlayerFormValues,
} from './PlayerFormFields';

interface PlayerFormProps {
  tournamentId: Id<"tournaments">;
  onClose: () => void;
}

export function PlayerForm({ tournamentId, onClose }: PlayerFormProps) {
  const createPlayer = useMutation(api.players.create);
  const tournament = useQuery(api.tournaments.getById, { id: tournamentId });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState<PlayerFormValues>({
    name: '',
    phoneNumber: '',
    age: 24,
    role: [],
    battingBowlingHand: 'Right-handed',
    tshirtSize: 'L',
    jerseyNumber: undefined,
    jerseyName: '',
    basePrice: undefined,
    photoUrl: '',
  });

  // Patch form state and clear any errors on the fields being edited.
  const patchForm = (patch: Partial<PlayerFormValues>) => {
    setFormData((prev) => ({ ...prev, ...patch }));
    setErrors((prev) => {
      const next = { ...prev };
      Object.keys(patch).forEach((k) => delete next[k]);
      return next;
    });
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Player name is required';
    } else if (formData.name.trim().length < 2) {
      newErrors.name = 'Name must be at least 2 characters';
    } else if (formData.name.trim().length > 50) {
      newErrors.name = 'Name must be less than 50 characters';
    }

    if (formData.phoneNumber && !/^[0-9]{10}$/.test(formData.phoneNumber)) {
      newErrors.phoneNumber = 'Phone number must be 10 digits';
    }

    if (formData.jerseyNumber !== undefined) {
      if (formData.jerseyNumber < 1 || formData.jerseyNumber > 99) {
        newErrors.jerseyNumber = 'Jersey number must be between 1 and 99';
      }
    }

    setErrors(newErrors);

    const firstError = Object.values(newErrors)[0];
    if (firstError) toast.error(firstError);

    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setLoading(true);
    try {
      await createPlayer({
        tournamentId,
        name: formData.name,
        phoneNumber: formData.phoneNumber || undefined,
        age: formData.age,
        role: formData.role,
        battingBowlingHand: formData.battingBowlingHand as 'Right-handed' | 'Left-handed',
        tshirtSize: formData.tshirtSize,
        jerseyNumber: formData.jerseyNumber,
        jerseyName: formData.jerseyName || undefined,
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

  const defaultBase = (tournament?.settings?.basePrice ?? 100000) / 100000;

  return (
    <PlayerFormModal
      mode="add"
      title="Add New Player"
      subtitle="Create a player profile for this tournament"
      submitLabel="Add Player"
      loadingLabel="Adding…"
      loading={loading}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <PlayerFormFields
        values={formData}
        errors={errors}
        onChange={patchForm}
        basePricePlaceholder={`Default: ₹${defaultBase.toFixed(1)}L`}
        basePriceHint={
          formData.basePrice
            ? `Overridden: ₹${(formData.basePrice / 100000).toFixed(2)}L`
            : 'Leave empty to inherit from tournament'
        }
      />
    </PlayerFormModal>
  );
}
