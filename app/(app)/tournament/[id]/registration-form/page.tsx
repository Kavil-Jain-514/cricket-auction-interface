"use client";

import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from 'convex/react';
import { ArrowLeft, Eye, Save } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ds/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ds/dialog';
import { FormBuilder } from '@/components/registration/FormBuilder';
import { CustomQuestions, type AnswerMap } from '@/components/registration/CustomQuestions';
import { ShareRegistration } from '@/components/registration/ShareRegistration';
import { useTournamentRole } from '@/hooks/useTournamentRole';
import { normalizeQuestions, validateFormQuestions, type Question } from '@/convex/registrationForm';
import { getErrorMessage } from '@/lib/utils';

/** Drop blank option lines before validating (the textarea keeps them while typing). */
const tidy = (questions: Question[]) =>
  normalizeQuestions(questions).map((q) => (q.options ? { ...q, options: q.options.filter((o) => o !== '') } : q));

/** Owner-only: build the tournament's own registration questions. */
export default function RegistrationFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const tournamentId = id as Id<"tournaments">;
  const { canManage, isLoading } = useTournamentRole(tournamentId);
  const tournament = useQuery(api.tournaments.getById, { id: tournamentId });
  const saved = useQuery(api.registrationForms.get, canManage ? { tournamentId } : 'skip');
  const save = useMutation(api.registrationForms.save);

  // The draft starts from the saved form and is re-based whenever a save lands.
  const [draft, setDraft] = useState<{ base: number; questions: Question[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewAnswers, setPreviewAnswers] = useState<AnswerMap>({});

  if (saved && (draft === null || (draft.base !== saved.version && !isDirty(draft.questions, saved.questions)))) {
    setDraft({ base: saved.version, questions: saved.questions });
  }
  const questions = draft?.questions ?? [];
  const dirty = draft !== null && saved !== undefined && isDirty(draft.questions, saved.questions);
  const formUrl = typeof window !== 'undefined' ? `${window.location.origin}/register/${tournamentId}` : `/register/${tournamentId}`;

  const handleSave = async () => {
    if (!draft) return;
    const cleaned = tidy(draft.questions);
    const error = validateFormQuestions(cleaned);
    if (error) return toast.error(error);
    setSaving(true);
    try {
      const { version } = await save({ tournamentId, questions: cleaned, expectedVersion: draft.base });
      setDraft({ base: version, questions: cleaned });
      toast.success('Form saved. New registrations see it now.');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not save the form'));
    } finally {
      setSaving(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-linear-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <Navbar />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 pb-28 sm:py-8">{children}</main>
    </div>
  );

  if (isLoading || (canManage && saved === undefined)) {
    return shell(
      <div className="space-y-4" aria-busy="true" aria-label="Loading the form">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>,
    );
  }
  if (!canManage) {
    return shell(<p className="rounded-xl border border-slate-800 bg-slate-900 p-5 text-slate-300">Only the tournament&apos;s owner can edit its registration form.</p>);
  }

  const activeQuestions = tidy(questions).filter((q) => !q.archived);

  return shell(
    <>
      <Link href={`/tournament/${tournamentId}/registrations`} className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-400 hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Registrations
      </Link>
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Registration form</h1>
        <p className="text-sm text-slate-400">
          Add your own questions after the standard player details. Changes apply to new registrations; earlier answers are kept as they were.
        </p>
      </div>

      <ShareRegistration url={formUrl} tournamentName={tournament?.name ?? 'Tournament'} />

      <FormBuilder
        questions={questions}
        onChange={(next) => setDraft((d) => ({ base: d?.base ?? saved?.version ?? 0, questions: next }))}
        answerCounts={saved?.answerCounts ?? {}}
      />

      {/* Sticky action bar, clear of the home indicator on notched phones. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-800 bg-slate-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          <span className="mr-auto text-sm text-slate-400" aria-live="polite">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setPreviewing(true)}>
            <Eye className="h-4 w-4" /> View registration form
          </Button>
          <Button type="button" className="min-h-11" disabled={!dirty || saving} onClick={handleSave}>
            <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <Dialog open={previewing} onOpenChange={setPreviewing}>
        <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
          <DialogTitle className="text-xl">Preview</DialogTitle>
          <DialogDescription>
            What players see after the standard details{dirty ? ' (including unsaved changes)' : ''}. Nothing here is submitted.
          </DialogDescription>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-white">
            {activeQuestions.length === 0 ? (
              <p className="text-sm text-slate-400">Only the standard player details are asked.</p>
            ) : (
              <CustomQuestions
                preview
                questions={activeQuestions}
                answers={previewAnswers}
                errors={{}}
                onChange={(qid, value) => setPreviewAnswers((a) => ({ ...a, [qid]: value }))}
              />
            )}
          </div>
          <Button asChild variant="outline" className="min-h-11">
            <a href={formUrl} target="_blank" rel="noopener noreferrer">Open the live form</a>
          </Button>
        </DialogContent>
      </Dialog>
    </>,
  );
}

function isDirty(draft: Question[], saved: Question[]): boolean {
  return JSON.stringify(normalizeQuestions(draft)) !== JSON.stringify(normalizeQuestions(saved));
}
