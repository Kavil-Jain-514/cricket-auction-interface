"use client";

import { useState } from 'react';
import { useMutation } from 'convex/react';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { FormModal } from '@/components/ui/form-modal';
import { getErrorMessage } from '@/lib/utils';
import { TEAM_PRESET_COLORS } from './TeamColorPicker';
import { TeamDetailsFields, teamDetailsErrors, type TeamDetailsValues } from './TeamFormFields';

/** A team owner asks for their team in a tournament; the organiser verifies it. */
export function TeamRequestForm({
  tournamentId,
  tournamentName,
  defaultOwnerName = '',
  onClose,
}: {
  tournamentId: Id<"tournaments">;
  tournamentName: string;
  defaultOwnerName?: string;
  onClose: () => void;
}) {
  const submit = useMutation(api.teamRequests.submit);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [values, setValues] = useState<TeamDetailsValues>({
    name: '',
    ownerName: defaultOwnerName,
    sponsorName: '',
    logoUrl: '',
    colorPrimary: TEAM_PRESET_COLORS[0].primary,
    colorSecondary: TEAM_PRESET_COLORS[0].secondary,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors = teamDetailsErrors(values);
    setErrors(newErrors);
    const firstError = Object.values(newErrors)[0];
    if (firstError) return toast.error(firstError);
    setLoading(true);
    try {
      await submit({
        tournamentId,
        name: values.name,
        ownerName: values.ownerName,
        sponsorName: values.sponsorName || undefined,
        logoUrl: values.logoUrl || undefined,
        colorPrimary: values.colorPrimary,
        colorSecondary: values.colorSecondary,
      });
      toast.success('Request sent. The organiser will verify your team.');
      onClose();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not send the request'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <FormModal
      icon={ShieldCheck}
      title="Register your team"
      subtitle={`${tournamentName} · the organiser verifies you and your team`}
      width="2xl"
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel="Send for verification"
      loadingLabel="Sending…"
      loading={loading}
    >
      <TeamDetailsFields
        values={values}
        errors={errors}
        onChange={(patch) => {
          setValues((prev) => ({ ...prev, ...patch }));
          setErrors({});
        }}
      />
    </FormModal>
  );
}
