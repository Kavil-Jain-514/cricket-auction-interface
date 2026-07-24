"use client";

import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Doc } from '@/convex/_generated/dataModel';
import { toast } from 'sonner';
import { getErrorMessage, getRoles } from '@/lib/utils';
import {
  PlayerFormModal,
  PlayerFormFields,
  type PlayerFormValues,
  type TshirtSize,
} from './PlayerFormFields';

interface PlayerEditFormProps {
  player: Doc<"players">;
  onClose: () => void;
  onSuccess: () => void;
}

export function PlayerEditForm({ player, onClose, onSuccess }: PlayerEditFormProps) {
  const updatePlayer = useMutation(api.players.update);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState<PlayerFormValues>({
    name: player.name,
    phoneNumber: player.phoneNumber || '',
    age: player.age,
    role: getRoles(player.role),
    battingBowlingHand: player.battingBowlingHand,
    tshirtSize: (player.tshirtSize || 'L') as TshirtSize,
    jerseyNumber: player.jerseyNumber,
    jerseyName: player.jerseyName || '',
    basePrice: player.basePrice,
    photoUrl: player.photoUrl || '',
  });

  const patchForm = (patch: Partial<PlayerFormValues>) =>
    setFormData((prev) => ({ ...prev, ...patch }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    // Normalize hand to handle legacy data ("Right" -> "Right-handed").
    let normalizedHand = formData.battingBowlingHand;
    if (normalizedHand === 'Right') normalizedHand = 'Right-handed';
    if (normalizedHand === 'Left') normalizedHand = 'Left-handed';

    try {
      await updatePlayer({
        id: player._id,
        name: formData.name,
        phoneNumber: formData.phoneNumber || undefined,
        age: formData.age,
        role: formData.role,
        battingBowlingHand: normalizedHand as 'Right-handed' | 'Left-handed',
        tshirtSize: formData.tshirtSize,
        jerseyNumber: formData.jerseyNumber,
        jerseyName: formData.jerseyName || undefined,
        basePrice: formData.basePrice,
        photoUrl: formData.photoUrl || undefined,
      });

      toast.success('Player updated successfully!');
      onSuccess();
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update player'));
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PlayerFormModal
      mode="edit"
      title="Edit Player"
      subtitle={player.name}
      submitLabel="Update Player"
      loadingLabel="Updating…"
      loading={loading}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <PlayerFormFields
        values={formData}
        onChange={patchForm}
        basePricePlaceholder="Inherit from tournament"
        basePriceHint={
          formData.basePrice
            ? `Overridden: ₹${(formData.basePrice / 100000).toFixed(2)}L`
            : 'Leaving empty inherits from tournament'
        }
      />
    </PlayerFormModal>
  );
}
