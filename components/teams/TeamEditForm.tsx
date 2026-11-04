"use client";

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Doc, Id } from '@/convex/_generated/dataModel';
import { Lock, Pencil } from 'lucide-react';
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
  /** The team's own owner: details only, no captain (teams:update enforces it). */
  asTeamOwner?: boolean;
  /**
   * The auction has started, so an owner can't save. Arrives live from
   * teams:getMine; the form stays open with the owner's unsaved input.
   */
  locked?: boolean;
}

export function TeamEditForm({ team, onClose, onSuccess, asTeamOwner = false, locked = false }: TeamEditFormProps) {
  const updateTeam = useMutation(api.teams.update);
  // Owners never see the captain tab, so they skip its player list.
  const players = useQuery(api.players.listByTournament, asTeamOwner ? 'skip' : { tournamentId: team.tournamentId });
  const teams = useQuery(api.teams.listByTournament, asTeamOwner ? 'skip' : { tournamentId: team.tournamentId });
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
    if (locked) return;
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
        ...(asTeamOwner ? {} : {
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
        }),
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
      submitDisabled={locked}
      nav={asTeamOwner ? undefined : (
        <FormTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'team', label: 'Team details', error: Object.keys(errors).length > 0 },
            { key: 'captain', label: 'Captain' },
          ]}
        />
      )}
    >
      {locked && (
        <p role="status" className="mb-4 flex items-start gap-2 rounded-lg border border-amber-600/40 bg-amber-600/10 px-3 py-2.5 text-sm text-amber-200">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          The auction has started, so team details are locked and this can&apos;t be saved. Your changes are still shown here; ask the organiser if something needs to change.
        </p>
      )}
      {tab === 'team' || asTeamOwner ? (
        <fieldset disabled={locked} className="min-w-0 disabled:opacity-60">
          <TeamDetailsFields values={details} errors={errors} onChange={(patch) => setDetails((prev) => ({ ...prev, ...patch }))} />
        </fieldset>
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
