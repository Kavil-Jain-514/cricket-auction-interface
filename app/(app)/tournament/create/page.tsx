"use client";

import { useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Gavel, Info, Trophy } from 'lucide-react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ImageUpload } from '@/components/ui/image-upload';
import { NativeSelect } from '@/components/ui/native-select';
import { Field, FormDivider, FormShell, SectionHeading, formInputCls } from '@/components/ui/form-modal';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { DEFAULT_BID_TIMER_SECONDS } from '@/convex/bidRules';
import { BID_TIMER_OPTIONS, bidTimerLabel } from '@/lib/bidTimer';

export default function CreateTournamentPage() {
  const router = useRouter();
  const createTournament = useMutation(api.tournaments.create);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    logoUrl: '',
    basePurse: 4000000,
    minBidIncrement: 25000,
    maxPlayersPerTeam: 15,
    basePrice: 100000,
    bidTimerSeconds: DEFAULT_BID_TIMER_SECONDS,
  });

  const [loading, setLoading] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Tournament name validation
    if (!formData.name.trim()) {
      newErrors.name = 'Tournament name is required';
    } else if (formData.name.trim().length < 3) {
      newErrors.name = 'Tournament name must be at least 3 characters';
    } else if (formData.name.trim().length > 50) {
      newErrors.name = 'Tournament name must be less than 50 characters';
    }

    // Base purse validation
    if (!formData.basePurse || formData.basePurse < 100000) {
      newErrors.basePurse = 'Base purse must be at least ₹1 Lakh';
    } else if (formData.basePurse > 1000000000) {
      newErrors.basePurse = 'Base purse cannot exceed ₹100 Crore';
    }

    // Min bid increment validation
    if (!formData.minBidIncrement || formData.minBidIncrement < 5000) {
      newErrors.minBidIncrement = 'Minimum bid increment must be at least ₹5,000';
    } else if (formData.minBidIncrement > formData.basePurse / 10) {
      newErrors.minBidIncrement = 'Bid increment cannot exceed 10% of base purse';
    }

    // Base price validation removed

    // Max players validation removed

    setErrors(newErrors);

    // Show first error as toast
    const firstError = Object.values(newErrors)[0];
    if (firstError) {
      toast.error(firstError);
    }

    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const tournamentId = await createTournament({
        name: formData.name,
        description: formData.description,
        logoUrl: logoPreview || undefined,
        settings: {
          basePurse: formData.basePurse,
          minBidIncrement: formData.minBidIncrement,
          maxPlayersPerTeam: formData.maxPlayersPerTeam,
          basePrice: formData.basePrice,
          bidTimerSeconds: formData.bidTimerSeconds,
        },
      });

      toast.success('Tournament created successfully!');
      router.push(`/tournament/${tournamentId}`);
    } catch (error) {
      toast.error((error as Error)?.message || 'Failed to create tournament');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const patch = (p: Partial<typeof formData>) => {
    setFormData((prev) => ({ ...prev, ...p }));
    setErrors((prev) => {
      const next = { ...prev };
      Object.keys(p).forEach((k) => delete next[k]);
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-4 py-4 sm:px-6">
        <Link href="/dashboard" className="mb-2 inline-flex w-fit items-center gap-2 py-1 text-sm text-slate-400 transition hover:text-white">
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>

        <FormShell
          icon={Trophy}
          title="Create New Tournament"
          subtitle="Set up your cricket auction; you can change everything later in Settings"
          onSubmit={handleSubmit}
          onCancel={() => router.push('/dashboard')}
          submitLabel="Create Tournament"
          loadingLabel="Creating…"
          loading={loading}
          className="max-h-none sm:max-h-[calc(100dvh-4rem)]"
        >
          <div className="space-y-4">
            <section>
              <SectionHeading icon={Info} title="Basic Information" />
              <div className="grid grid-cols-[6.5rem_1fr] gap-4 sm:grid-cols-[8.5rem_1fr] sm:gap-5">
                <Field label="Logo">
                  <ImageUpload
                    value={logoPreview || undefined}
                    onChange={(url) => setLogoPreview(url || null)}
                    folder="tournaments"
                    aspectRatio="square"
                  />
                </Field>
                <div className="space-y-3">
                  <Field label="Tournament Name *" htmlFor="name" error={errors.name}>
                    <Input
                      id="name"
                      required
                      value={formData.name}
                      onChange={(e) => patch({ name: e.target.value })}
                      placeholder="e.g., IPL 2025 Mega Auction"
                      className={cn(formInputCls, errors.name && 'border-red-500')}
                    />
                  </Field>
                  <Field label="Description" htmlFor="description">
                    <Textarea
                      id="description"
                      value={formData.description}
                      onChange={(e) => patch({ description: e.target.value })}
                      placeholder="Brief description of your tournament..."
                      rows={2}
                      className="min-h-16 resize-none"
                    />
                  </Field>
                </div>
              </div>
            </section>

            <FormDivider />

            <section>
              <SectionHeading icon={Gavel} title="Auction Settings" />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Field
                  label="Base Purse (₹) *"
                  htmlFor="basePurse"
                  error={errors.basePurse}
                  hint={`₹${(formData.basePurse / 100000).toFixed(1)}L per team`}
                >
                  <Input
                    id="basePurse"
                    type="number"
                    required
                    value={formData.basePurse}
                    onChange={(e) => patch({ basePurse: parseInt(e.target.value) || 0 })}
                    className={cn(formInputCls, errors.basePurse && 'border-red-500')}
                  />
                </Field>
                <Field
                  label="Min Bid Increment (₹) *"
                  htmlFor="minBidIncrement"
                  error={errors.minBidIncrement}
                  hint={`₹${(formData.minBidIncrement / 1000).toFixed(0)}K`}
                >
                  <Input
                    id="minBidIncrement"
                    type="number"
                    required
                    value={formData.minBidIncrement}
                    onChange={(e) => patch({ minBidIncrement: parseInt(e.target.value) || 0 })}
                    className={cn(formInputCls, errors.minBidIncrement && 'border-red-500')}
                  />
                </Field>
                <Field
                  label="Base Player Price (₹) *"
                  htmlFor="basePrice"
                  hint={`₹${(formData.basePrice / 100000).toFixed(1)}L`}
                >
                  <Input
                    id="basePrice"
                    type="number"
                    required
                    value={formData.basePrice}
                    onChange={(e) => patch({ basePrice: parseInt(e.target.value) || 0 })}
                    className={formInputCls}
                  />
                </Field>
                <Field label="Max Players / Team *" htmlFor="maxPlayersPerTeam">
                  <Input
                    id="maxPlayersPerTeam"
                    type="number"
                    required
                    value={formData.maxPlayersPerTeam}
                    onChange={(e) => patch({ maxPlayersPerTeam: parseInt(e.target.value) || 0 })}
                    className={formInputCls}
                  />
                </Field>
                <Field label="Bid Timer" htmlFor="bidTimerSeconds" hint="Resets on every bid; never sells on its own." className="col-span-2">
                  <NativeSelect
                    id="bidTimerSeconds"
                    value={formData.bidTimerSeconds}
                    onChange={(e) => patch({ bidTimerSeconds: Number(e.target.value) })}
                    className={formInputCls}
                  >
                    {BID_TIMER_OPTIONS.map((s) => (
                      <option key={s} value={s}>{bidTimerLabel(s)}</option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
            </section>
          </div>
        </FormShell>
      </main>
    </div>
  );
}
