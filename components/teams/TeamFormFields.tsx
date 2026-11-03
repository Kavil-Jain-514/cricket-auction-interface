"use client";

import { Crown, Palette, Shield } from 'lucide-react';
import type { Doc } from '@/convex/_generated/dataModel';
import { Input } from '@/components/ui/input';
import { ImageUpload } from '@/components/ui/image-upload';
import { NativeSelect } from '@/components/ui/native-select';
import { Field, FormDivider, SectionHeading, formInputCls } from '@/components/ui/form-modal';
import { cn, getRoleDisplay, getRoles } from '@/lib/utils';
import { TeamColorPicker } from './TeamColorPicker';

type CaptainRole = '' | 'Batter' | 'Bowler' | 'All-Rounder';
type CaptainHand = '' | 'Right' | 'Left';

export interface TeamDetailsValues {
  name: string;
  ownerName: string;
  sponsorName: string;
  logoUrl: string;
  colorPrimary: string;
  colorSecondary: string;
}

export interface CaptainValues {
  captainPlayerId: string;
  captainName: string;
  captainPhotoUrl: string;
  captainAge: number | undefined;
  captainRole: CaptainRole;
  captainHand: CaptainHand;
}

/** Captain fields previewed from a player (the server re-derives them). */
export function captainFromPlayer(player: Doc<"players">): CaptainValues {
  const primaryRole = getRoles(player.role)[0];
  return {
    captainPlayerId: player._id,
    captainName: player.name,
    captainPhotoUrl: player.photoUrl || '',
    captainAge: player.age,
    captainRole: (['Batter', 'Bowler', 'All-Rounder'].includes(primaryRole) ? primaryRole : '') as CaptainRole,
    captainHand: player.battingBowlingHand.includes('Right') ? 'Right' : 'Left',
  };
}

/** Team name, owner, sponsor, logo and colours. */
export function TeamDetailsFields({
  values,
  errors,
  onChange,
}: {
  values: TeamDetailsValues;
  errors?: Record<string, string>;
  onChange: (patch: Partial<TeamDetailsValues>) => void;
}) {
  return (
    <div className="space-y-4">
      <section>
        <SectionHeading icon={Shield} title="Team Details" />
        <div className="grid grid-cols-[6.5rem_1fr] gap-4 sm:grid-cols-[8.5rem_1fr] sm:gap-5">
          <Field label="Logo">
            <ImageUpload
              value={values.logoUrl}
              onChange={(url) => onChange({ logoUrl: url || '' })}
              folder="teams"
              aspectRatio="square"
            />
          </Field>
          <div className="grid grid-cols-1 content-start gap-3 sm:grid-cols-2">
            <Field label="Team Name *" htmlFor="team-name" error={errors?.name} className="sm:col-span-2">
              <Input
                id="team-name"
                required
                value={values.name}
                onChange={(e) => onChange({ name: e.target.value })}
                placeholder="e.g., Mumbai Masters"
                className={cn(formInputCls, errors?.name && 'border-red-500')}
              />
            </Field>
            <Field label="Owner Name *" htmlFor="team-owner" error={errors?.ownerName}>
              <Input
                id="team-owner"
                required
                value={values.ownerName}
                onChange={(e) => onChange({ ownerName: e.target.value })}
                placeholder="e.g., John Doe"
                className={cn(formInputCls, errors?.ownerName && 'border-red-500')}
              />
            </Field>
            <Field label="Sponsor" htmlFor="team-sponsor">
              <Input
                id="team-sponsor"
                value={values.sponsorName}
                onChange={(e) => onChange({ sponsorName: e.target.value })}
                placeholder="Optional"
                className={formInputCls}
              />
            </Field>
          </div>
        </div>
      </section>

      <FormDivider />

      <section>
        <SectionHeading icon={Palette} title="Team Colour" />
        <TeamColorPicker
          label=""
          primary={values.colorPrimary}
          secondary={values.colorSecondary}
          onChange={(colorPrimary, colorSecondary) => onChange({ colorPrimary, colorSecondary })}
        />
      </section>
    </div>
  );
}

/** Captain: picked from the tournament's players, or entered by hand. */
export function CaptainFields({
  values,
  onChange,
  players,
}: {
  values: CaptainValues;
  onChange: (patch: Partial<CaptainValues>) => void;
  /** Players who can still be picked (not captaining another team). */
  players: Doc<"players">[];
}) {
  const linked = values.captainPlayerId !== '';
  const handleSelect = (value: string) => {
    if (value === '') return onChange({ captainPlayerId: '' });
    const player = players.find((p) => p._id === value);
    if (player) onChange(captainFromPlayer(player));
  };

  return (
    <section>
      <SectionHeading icon={Crown} title="Captain" hint="optional, can be added later" />
      <div className="space-y-3">
        <Field
          label="Pick from players"
          htmlFor="captain-player"
          hint={linked ? 'Details come from the player’s profile; they get a "C" tag in the players list.' : undefined}
        >
          <NativeSelect
            id="captain-player"
            value={values.captainPlayerId}
            onChange={(e) => handleSelect(e.target.value)}
            className={formInputCls}
          >
            <option value="">None — enter details by hand</option>
            {players.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name} ({getRoleDisplay(p.role)})
              </option>
            ))}
          </NativeSelect>
        </Field>

        <div className={cn('grid gap-4', linked ? 'grid-cols-1' : 'grid-cols-[6.5rem_1fr] sm:grid-cols-[8.5rem_1fr]')}>
          {!linked && (
            <Field label="Photo">
              <ImageUpload
                value={values.captainPhotoUrl}
                onChange={(url) => onChange({ captainPhotoUrl: url || '' })}
                folder="players"
                aspectRatio="square"
              />
            </Field>
          )}
          <div className="grid grid-cols-2 content-start gap-3">
            <Field label="Captain Name" htmlFor="captain-name" className="col-span-2 sm:col-span-1">
              <Input
                id="captain-name"
                value={values.captainName}
                onChange={(e) => onChange({ captainName: e.target.value })}
                placeholder="e.g., Virat Kohli"
                disabled={linked}
                className={formInputCls}
              />
            </Field>
            <Field label="Age" htmlFor="captain-age" className="col-span-2 sm:col-span-1">
              <Input
                id="captain-age"
                type="number"
                min="1"
                value={values.captainAge || ''}
                onChange={(e) => onChange({ captainAge: e.target.value ? parseInt(e.target.value) : undefined })}
                placeholder="e.g., 35"
                disabled={linked}
                className={formInputCls}
              />
            </Field>
            <Field label="Role" htmlFor="captain-role">
              <NativeSelect
                id="captain-role"
                value={values.captainRole}
                onChange={(e) => onChange({ captainRole: e.target.value as CaptainRole })}
                disabled={linked}
                className={formInputCls}
              >
                <option value="">Select role</option>
                <option value="Batter">Batter</option>
                <option value="Bowler">Bowler</option>
                <option value="All-Rounder">All-Rounder</option>
              </NativeSelect>
            </Field>
            <Field label="Hand" htmlFor="captain-hand">
              <NativeSelect
                id="captain-hand"
                value={values.captainHand}
                onChange={(e) => onChange({ captainHand: e.target.value as CaptainHand })}
                disabled={linked}
                className={formInputCls}
              >
                <option value="">Select hand</option>
                <option value="Right">Right-handed</option>
                <option value="Left">Left-handed</option>
              </NativeSelect>
            </Field>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Mirrors convex/validation.ts; the server re-checks. */
export function teamDetailsErrors(values: TeamDetailsValues): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = values.name.trim();
  if (!name) errors.name = 'Team name is required';
  else if (name.length < 2) errors.name = 'Team name must be at least 2 characters';
  else if (name.length > 29) errors.name = 'Team name must be at most 29 characters';
  const owner = values.ownerName.trim();
  if (!owner) errors.ownerName = 'Owner name is required';
  else if (owner.length < 2) errors.ownerName = 'Owner name must be at least 2 characters';
  return errors;
}
