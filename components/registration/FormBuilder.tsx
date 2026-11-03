"use client";

import { useState } from 'react';
import { ArrowDown, ArrowUp, Archive, Copy, GripVertical, Lock, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { CHOICE_TYPES, FORM_LIMITS, newQuestionId, type Question, type QuestionType } from '@/convex/registrationForm';

export const TYPE_LABELS: Record<QuestionType, string> = {
  short_text: 'Short answer',
  long_text: 'Paragraph',
  number: 'Number',
  amount: 'Amount (₹)',
  dropdown: 'Dropdown',
  multiple_choice: 'Multiple choice (one)',
  checkboxes: 'Checkboxes (many)',
  date: 'Date',
  phone: 'Phone',
  email: 'Email',
  file: 'Image upload',
};

/** Always on the form (the auction needs them); shown locked in the builder. */
const SYSTEM_FIELDS = [
  'Photo',
  'Full name',
  'Mobile',
  'Age',
  'Role',
  'Category (when the tournament has categories)',
  'Batting / bowling hand',
  'T-shirt size, jersey number and name',
  'WhatsApp consent',
  'Payment screenshot (when there is a fee)',
];

const inputCls = 'h-11 bg-slate-950/60 border-slate-700 text-base md:text-sm';

function blank(type: QuestionType): Question {
  return { id: newQuestionId(), type, label: '', required: false, ...(CHOICE_TYPES.includes(type) ? { options: ['Option 1'] } : {}) };
}

/**
 * Edits the organiser's questions. Reorder by drag and drop or with the
 * arrow buttons (keyboard). Answered questions are archived, not deleted,
 * and their type is locked. The page saves; this only edits a draft.
 */
export function FormBuilder({
  questions,
  onChange,
  answerCounts,
}: {
  questions: Question[];
  onChange: (questions: Question[]) => void;
  answerCounts: Record<string, number>;
}) {
  const confirm = useConfirm();
  const [addType, setAddType] = useState<QuestionType>('short_text');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const active = questions.filter((q) => !q.archived);
  const archived = questions.filter((q) => q.archived);
  const atLimit = active.length >= FORM_LIMITS.maxQuestions;

  // Edits address active questions by position; archived ones keep their place at the end.
  const setActive = (next: Question[]) => onChange([...next, ...archived]);
  const patch = (i: number, p: Partial<Question>) => setActive(active.map((q, j) => (j === i ? { ...q, ...p } : q)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= active.length || from === to) return;
    const next = [...active];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setActive(next);
    // Keep keyboard focus on the moved card's same button.
    requestAnimationFrame(() => document.getElementById(`q-card-${item.id}`)?.focus());
  };

  const remove = async (i: number) => {
    const q = active[i];
    const answers = answerCounts[q.id] ?? 0;
    if (answers > 0) {
      const ok = await confirm({
        title: `Archive "${q.label || 'this question'}"?`,
        description: `${answers} registration${answers === 1 ? ' has' : 's have'} answered it. It will be hidden from the form; the answers are kept and still shown to you.`,
        confirmText: 'Archive',
      });
      if (ok) onChange([...active.filter((_, j) => j !== i), ...archived, { ...q, archived: true }]);
      return;
    }
    setActive(active.filter((_, j) => j !== i));
  };

  return (
    <div className="space-y-6">
      <section aria-labelledby="locked-fields" className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 id="locked-fields" className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-400">
          <Lock className="h-4 w-4" aria-hidden /> Always asked
        </h2>
        <p className="mt-1 text-sm text-slate-500">The auction needs these, so they stay on every form, first.</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {SYSTEM_FIELDS.map((f) => (
            <li key={f} className="rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1 text-xs text-slate-300">{f}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="your-questions" className="space-y-3">
        <h2 id="your-questions" className="text-lg font-bold">Your questions</h2>
        {active.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
            No questions yet. Add one below, e.g. &ldquo;Which club do you play for?&rdquo;
          </p>
        )}
        <ol className="space-y-3">
          {active.map((q, i) => {
            const answered = answerCounts[q.id] ?? 0;
            const isChoice = CHOICE_TYPES.includes(q.type);
            return (
              <li
                key={q.id}
                id={`q-card-${q.id}`}
                tabIndex={-1}
                aria-label={`Question ${i + 1}: ${q.label || 'untitled'}`}
                onDragOver={(e) => {
                  if (dragIndex === null) return;
                  e.preventDefault();
                  setOverIndex(i);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null) move(dragIndex, i);
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                className={cn(
                  'rounded-xl border bg-slate-800/50 p-4 transition focus-visible:outline-2 focus-visible:outline-blue-400 motion-reduce:transition-none',
                  overIndex === i && dragIndex !== i ? 'border-blue-500' : 'border-slate-700',
                  dragIndex === i && 'opacity-50',
                )}
              >
                <div className="flex items-start gap-2">
                  <span
                    draggable
                    onDragStart={(e) => {
                      setDragIndex(i);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setOverIndex(null);
                    }}
                    title="Drag to reorder"
                    className="mt-2.5 hidden cursor-grab text-slate-500 hover:text-slate-300 sm:block"
                    aria-hidden
                  >
                    <GripVertical className="h-5 w-5" />
                  </span>
                  <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[1fr_13rem]">
                    <div>
                      <label htmlFor={`q-label-${q.id}`} className="sr-only">Question {i + 1}</label>
                      <Input
                        id={`q-label-${q.id}`}
                        value={q.label}
                        maxLength={FORM_LIMITS.labelMax}
                        placeholder="Question"
                        onChange={(e) => patch(i, { label: e.target.value })}
                        className={cn(inputCls, 'font-medium')}
                      />
                    </div>
                    <div>
                      <label htmlFor={`q-type-${q.id}`} className="sr-only">Answer type</label>
                      <NativeSelect
                        id={`q-type-${q.id}`}
                        value={q.type}
                        disabled={answered > 0}
                        title={answered > 0 ? 'Answered questions keep their type' : undefined}
                        onChange={(e) => {
                          const type = e.target.value as QuestionType;
                          const choice = CHOICE_TYPES.includes(type);
                          patch(i, { type, options: choice ? (q.options?.length ? q.options : ['Option 1']) : undefined });
                        }}
                        className={inputCls}
                      >
                        {Object.entries(TYPE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </NativeSelect>
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor={`q-help-${q.id}`} className="sr-only">Help text</label>
                      <Input
                        id={`q-help-${q.id}`}
                        value={q.helpText ?? ''}
                        maxLength={FORM_LIMITS.helpMax}
                        placeholder="Help text (optional)"
                        onChange={(e) => patch(i, { helpText: e.target.value || undefined })}
                        className={cn(inputCls, 'text-slate-300')}
                      />
                    </div>
                    {isChoice && (
                      <div className="sm:col-span-2">
                        <label htmlFor={`q-options-${q.id}`} className="text-xs font-medium text-slate-400">
                          Options, one per line (up to {FORM_LIMITS.maxOptions})
                        </label>
                        <Textarea
                          id={`q-options-${q.id}`}
                          rows={Math.min(8, Math.max(3, (q.options?.length ?? 1) + 1))}
                          value={(q.options ?? []).join('\n')}
                          onChange={(e) => patch(i, { options: e.target.value.split('\n').slice(0, FORM_LIMITS.maxOptions) })}
                          className="mt-1 bg-slate-950/60 border-slate-700 text-base md:text-sm"
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-700/70 pt-3">
                  <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" checked={q.required} onChange={(e) => patch(i, { required: e.target.checked })} className="h-4 w-4 accent-blue-600" />
                    Required
                  </label>
                  <span className="text-xs text-slate-500">{answered > 0 ? `${answered} answer${answered === 1 ? '' : 's'}` : ''}</span>
                  <div className="flex items-center gap-1">
                    <IconButton label={`Move "${q.label || 'question'}" up`} disabled={i === 0} onClick={() => move(i, i - 1)}><ArrowUp /></IconButton>
                    <IconButton label={`Move "${q.label || 'question'}" down`} disabled={i === active.length - 1} onClick={() => move(i, i + 1)}><ArrowDown /></IconButton>
                    <IconButton
                      label={`Duplicate "${q.label || 'question'}"`}
                      disabled={atLimit}
                      onClick={() => setActive([...active.slice(0, i + 1), { ...q, id: newQuestionId(), label: `${q.label} (copy)`.slice(0, FORM_LIMITS.labelMax) }, ...active.slice(i + 1)])}
                    >
                      <Copy />
                    </IconButton>
                    <IconButton label={`${answered > 0 ? 'Archive' : 'Delete'} "${q.label || 'question'}"`} danger onClick={() => remove(i)}>
                      {answered > 0 ? <Archive /> : <Trash2 />}
                    </IconButton>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-slate-700 p-3 sm:flex-row sm:items-center">
          <label htmlFor="add-type" className="text-sm text-slate-400 sm:mr-auto">
            {atLimit ? `A form can have ${FORM_LIMITS.maxQuestions} questions.` : 'Add a question'}
          </label>
          <NativeSelect id="add-type" value={addType} onChange={(e) => setAddType(e.target.value as QuestionType)} disabled={atLimit} className={cn(inputCls, 'sm:w-56')}>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </NativeSelect>
          <Button
            type="button"
            disabled={atLimit}
            onClick={() => {
              const q = blank(addType);
              setActive([...active, q]);
              requestAnimationFrame(() => document.getElementById(`q-label-${q.id}`)?.focus());
            }}
            className="min-h-11"
          >
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
      </section>

      {archived.length > 0 && (
        <section aria-labelledby="archived-questions" className="space-y-2">
          <h2 id="archived-questions" className="text-sm font-semibold uppercase tracking-wider text-slate-400">Archived</h2>
          <p className="text-sm text-slate-500">Hidden from the form. Their answers stay on each registration.</p>
          <ul className="space-y-2">
            {archived.map((q) => (
              <li key={q.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-400">
                <span className="min-w-0 truncate">{q.label} · {TYPE_LABELS[q.type]} · {answerCounts[q.id] ?? 0} answers</span>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={atLimit}
                  onClick={() => onChange([...active, { ...q, archived: undefined }, ...archived.filter((a) => a.id !== q.id)])}
                  className="min-h-11 shrink-0"
                >
                  <RotateCcw className="h-4 w-4" /> Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function IconButton({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactElement }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-30 motion-reduce:transition-none [&_svg]:h-4 [&_svg]:w-4',
        danger ? 'hover:text-red-400' : 'hover:text-white',
      )}
    >
      {children}
    </button>
  );
}
