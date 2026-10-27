"use client";

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Doc, Id } from '@/convex/_generated/dataModel';
import { Pencil } from 'lucide-react';
import { FormModal, FormTabs } from '@/components/ui/form-modal';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/utils';
import {
  CaptainFields,
  TeamDetailsFields,
  teamDetailsErrors,
  type CaptainValues,
  type TeamDetailsValues,
} from './TeamFormFields';

interface TeamEditFormProps {
  team: Doc<"teams">;
  onClose: () => void;
  onSuccess: () => void;
}

export function TeamEditForm({ team, onClose, onSuccess }: TeamEditFormProps) {
  const updateTeam = useMutation(api.teams.update);
  const players = useQuery(api.players.listByTournament, { tournamentId: team.tournamentId });
  const teams = useQuery(api.teams.listByTournament, { tournamentId: team.tournamentId });
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'team' | 'captain'>('team');

  const [details, setDetails] = useState<TeamDetailsValues>({
    name: team.name,
    ownerName: team.ownerName,
    sponsorName: team.sponsorName || '',
    logoUrl: team.logoUrl || '',
    colorPrimary: team.colorPrimary,
    colorSecondary: team.colorSecondary,
  });
  const [captain, setCaptain] = useState<CaptainValues>({
    captainPlayerId: team.captainPlayerId || '',
    captainName: team.captainName || '',
    captainPhotoUrl: team.captainPhotoUrl || '',
    captainAge: team.captainAge,
    captainRole: team.captainRole || '',
    captainHand: team.captainHand || '',
  });
  const errors = teamDetailsErrors(details);

  // Players captaining OTHER teams can't be picked
  const takenCaptainIds = new Set(
    (teams ?? [])
      .filter((t) => t._id !== team._id)
      .flatMap((t) => (t.captainPlayerId ? [t.captainPlayerId] : [])),
  );
  const selectablePlayers = (players ?? []).filter((p) => !takenCaptainIds.has(p._id));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const firstError = Object.values(errors)[0];
    if (firstError) {
      setTab('team');
      toast.error(firstError);
      return;
    }
    setLoading(true);

    try {
      await updateTeam({
        id: team._id,
        name: details.name,
        ownerName: details.ownerName,
        sponsorName: details.sponsorName || undefined,
        logoUrl: details.logoUrl || undefined,
        colorPrimary: details.colorPrimary,
        colorSecondary: details.colorSecondary,
        // null clears a previously linked captain; undefined leaves it unchanged
        captainPlayerId: captain.captainPlayerId
          ? (captain.captainPlayerId as Id<"players">)
          : team.captainPlayerId
            ? null
            : undefined,
        captainName: captain.captainName || undefined,
        captainPhotoUrl: captain.captainPhotoUrl || undefined,
        captainAge: captain.captainAge,
        captainRole: captain.captainRole || undefined,
        captainHand: captain.captainHand || undefined,
      });

      toast.success('Team updated successfully!');
      onSuccess();
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update team'));
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormModal
      icon={Pencil}
      title="Edit Team"
      subtitle={team.name}
      width="2xl"
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel="Update Team"
      loadingLabel="Updating…"
      loading={loading}
      nav={
        <FormTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'team', label: 'Team details', error: Object.keys(errors).length > 0 },
            { key: 'captain', label: 'Captain' },
          ]}
        />
      }
    >
      {tab === 'team' ? (
        <TeamDetailsFields values={details} errors={errors} onChange={(patch) => setDetails((prev) => ({ ...prev, ...patch }))} />
      ) : (
        <CaptainFields
          values={captain}
          onChange={(patch) => setCaptain((prev) => ({ ...prev, ...patch }))}
          players={selectablePlayers}
        />
      )}
    </FormModal>
  );
}
