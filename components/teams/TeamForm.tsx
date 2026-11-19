"use client";

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { ChevronRight, ChevronLeft, Check, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormModal, FormSteps } from '@/components/ui/form-modal';
import { toast } from 'sonner';
import { TEAM_PRESET_COLORS } from './TeamColorPicker';
import {
  CaptainFields,
  TeamDetailsFields,
  teamDetailsErrors,
  type CaptainValues,
  type TeamDetailsValues,
} from './TeamFormFields';

interface TeamFormProps {
  tournamentId: Id<"tournaments">;
  onClose: () => void;
}

export function TeamForm({ tournamentId, onClose }: TeamFormProps) {
  const createTeam = useMutation(api.teams.create);
  const players = useQuery(api.players.listByTournament, { tournamentId });
  const teams = useQuery(api.teams.listByTournament, { tournamentId });
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<0 | 1>(0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [details, setDetails] = useState<TeamDetailsValues>({
    name: '',
    ownerName: '',
    sponsorName: '',
    logoUrl: '',
    colorPrimary: TEAM_PRESET_COLORS[0].primary,
    colorSecondary: TEAM_PRESET_COLORS[0].secondary,
  });
  const [captain, setCaptain] = useState<CaptainValues>({
    captainPlayerId: '',
    captainName: '',
    captainPhotoUrl: '',
    captainAge: undefined,
    captainRole: '',
    captainHand: '',
  });

  // Players already captaining another team can't be picked again
  const takenCaptainIds = new Set(
    (teams ?? []).flatMap((t) => (t.captainPlayerId ? [t.captainPlayerId] : [])),
  );
  const selectablePlayers = (players ?? []).filter((p) => !takenCaptainIds.has(p._id));

  const patchDetails = (patch: Partial<TeamDetailsValues>) => {
    setDetails((prev) => ({ ...prev, ...patch }));
    setErrors((prev) => {
      const next = { ...prev };
      Object.keys(patch).forEach((k) => delete next[k]);
      return next;
    });
  };

  const handleNext = () => {
    const newErrors = teamDetailsErrors(details);
    setErrors(newErrors);
    const firstError = Object.values(newErrors)[0];
    if (firstError) {
      toast.error(firstError);
      return;
    }
    setStep(1);
  };

  // Enter on the details step moves on; on the captain step it does nothing,
  // so the team is only created by clicking "Create Team" or "Skip captain".
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 0) handleNext();
  };

  const create = async ({ withCaptain }: { withCaptain: boolean }) => {
    if (loading) return;
    const c: Partial<CaptainValues> = withCaptain ? captain : {};
    setLoading(true);
    try {
      await createTeam({
        tournamentId,
        name: details.name,
        ownerName: details.ownerName,
        sponsorName: details.sponsorName || undefined,
        logoUrl: details.logoUrl || undefined,
        colorPrimary: details.colorPrimary,
        colorSecondary: details.colorSecondary,
        captainPlayerId: c.captainPlayerId
          ? (c.captainPlayerId as Id<"players">)
          : undefined,
        captainName: c.captainName || undefined,
        captainPhotoUrl: c.captainPhotoUrl || undefined,
        captainAge: c.captainAge,
        captainRole: c.captainRole || undefined,
        captainHand: c.captainHand || undefined,
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

  return (
    <FormModal
      icon={Users}
      title="Add New Team"
      subtitle="Create a team for this tournament"
      width="2xl"
      onClose={onClose}
      onSubmit={handleSubmit}
      nav={<FormSteps steps={['Team details', 'Captain']} current={step} />}
      // Every button is type="button" with its own key. Reusing one DOM
      // button that flips to type="submit" during the "Next" click made the
      // browser submit the form and skip the captain step.
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          {step === 0 ? (
            <>
              <Button key="cancel" type="button" variant="outline" onClick={onClose} className="h-10 sm:min-w-28">
                Cancel
              </Button>
              <Button key="next" type="button" onClick={handleNext} className="h-10 sm:min-w-36">
                Next: Captain
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button key="back" type="button" variant="outline" onClick={() => setStep(0)} disabled={loading} className="h-10 sm:min-w-28">
                <ChevronLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
              <Button key="skip" type="button" variant="outline" onClick={() => create({ withCaptain: false })} disabled={loading} className="h-10 sm:min-w-32">
                Skip captain
              </Button>
              <Button key="create" type="button" onClick={() => create({ withCaptain: true })} disabled={loading} className="h-10 sm:min-w-36">
                {loading ? 'Creating…' : 'Create Team'}
                {!loading && <Check className="ml-1 h-4 w-4" />}
              </Button>
            </>
          )}
        </div>
      }
    >
      {step === 0 ? (
        <TeamDetailsFields values={details} errors={errors} onChange={patchDetails} />
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
