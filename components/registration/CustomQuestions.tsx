"use client";

import { useState } from 'react';
import { Check, FileUp } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { AmountInput } from '@/components/ui/amount-input';
import { ImgWithFallback } from '@/components/ui/img-with-fallback';
import { formInputCls } from '@/components/ui/form-modal';
import { cn, getErrorMessage } from '@/lib/utils';
import type { AnswerValue, Question } from '@/convex/registrationForm';

export type AnswerMap = Record<string, AnswerValue | undefined>;

/** The registrant's answers as the server expects them (empties dropped). */
export function answersToSubmit(questions: Question[], answers: AnswerMap) {
  return questions.flatMap((q) => {
    const value = answers[q.id];
    return value === undefined ? [] : [{ questionId: q.id, value }];
  });
}

/** A label for one input, or (labelId) the name of a group of pills. */
function QuestionLabel({ q, htmlFor, labelId }: { q: Question; htmlFor?: string; labelId?: string }) {
  const content = (
    <>
      {q.label}
      {q.required && <span aria-hidden> *</span>}
      {q.required && <span className="sr-only"> (required)</span>}
    </>
  );
  const cls = 'text-sm font-medium text-slate-300';
  return labelId ? <span id={labelId} className={cls}>{content}</span> : <label htmlFor={htmlFor} className={cls}>{content}</label>;
}

function ChoicePills({
  q,
  selected,
  multiple,
  onToggle,
}: {
  q: Question;
  selected: string[];
  multiple: boolean;
  onToggle: (option: string) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2" role={multiple ? 'group' : 'radiogroup'} aria-labelledby={`${q.id}-label`}>
      {(q.options ?? []).map((option) => {
        const on = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            role={multiple ? 'checkbox' : 'radio'}
            aria-checked={on}
            onClick={() => onToggle(option)}
            className={cn(
              'inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-blue-400 motion-reduce:transition-none',
              on ? 'border-blue-500 bg-blue-600 text-white shadow' : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700',
            )}
          >
            {on && <Check className="h-3.5 w-3.5" aria-hidden />}
            {option}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The organiser's own questions on the public form (and in the builder's
 * preview, with `preview` set so nothing uploads). Inputs, errors and help
 * text are tied together for screen readers.
 */
export function CustomQuestions({
  questions,
  answers,
  errors,
  onChange,
  uploadFile,
  preview = false,
}: {
  questions: Question[];
  answers: AnswerMap;
  errors: Record<string, string>;
  onChange: (questionId: string, value: AnswerValue | undefined) => void;
  uploadFile?: (file: File) => Promise<string | null>;
  preview?: boolean;
}) {
  const [uploading, setUploading] = useState<string | null>(null);

  if (questions.length === 0) return null;

  return (
    <div className="space-y-4">
      {questions.map((q) => {
        const id = `cq-${q.id}`;
        const error = errors[q.id];
        const describedBy = [q.helpText ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
        const value = answers[q.id];
        const common = { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy, 'aria-required': q.required || undefined };
        const text = typeof value === 'string' ? value : '';
        const setText = (s: string) => onChange(q.id, s === '' ? undefined : s);

        let control: React.ReactNode;
        switch (q.type) {
          case 'short_text':
            control = <Input {...common} value={text} maxLength={200} onChange={(e) => setText(e.target.value)} className={formInputCls} />;
            break;
          case 'long_text':
            control = <Textarea {...common} value={text} maxLength={2000} rows={3} onChange={(e) => setText(e.target.value)} className={formInputCls} />;
            break;
          case 'number':
            control = (
              <Input
                {...common}
                type="number"
                inputMode="decimal"
                value={typeof value === 'number' ? value : ''}
                onChange={(e) => onChange(q.id, e.target.value === '' ? undefined : Number(e.target.value))}
                className={formInputCls}
              />
            );
            break;
          case 'amount':
            control = <AmountInput {...common} value={typeof value === 'number' ? value : undefined} onValueChange={(n) => onChange(q.id, n)} className={formInputCls} />;
            break;
          case 'dropdown':
            control = (
              <NativeSelect {...common} value={text} onChange={(e) => setText(e.target.value)} className={formInputCls}>
                <option value="">Choose…</option>
                {(q.options ?? []).map((o) => <option key={o}>{o}</option>)}
              </NativeSelect>
            );
            break;
          case 'multiple_choice':
            control = <ChoicePills q={q} selected={text ? [text] : []} multiple={false} onToggle={(o) => setText(text === o ? '' : o)} />;
            break;
          case 'checkboxes': {
            const picked = Array.isArray(value) ? value : [];
            control = (
              <ChoicePills
                q={q}
                selected={picked}
                multiple
                onToggle={(o) => {
                  const next = picked.includes(o) ? picked.filter((x) => x !== o) : [...picked, o];
                  onChange(q.id, next.length ? next : undefined);
                }}
              />
            );
            break;
          }
          case 'date':
            control = <Input {...common} type="date" value={text} onChange={(e) => setText(e.target.value)} className={formInputCls} />;
            break;
          case 'phone':
            control = <Input {...common} type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={text} onChange={(e) => setText(e.target.value)} className={formInputCls} />;
            break;
          case 'email':
            control = <Input {...common} type="email" inputMode="email" autoComplete="email" value={text} onChange={(e) => setText(e.target.value)} className={formInputCls} />;
            break;
          case 'file':
            control = (
              <div className="mt-1 flex items-center gap-3">
                {text && <ImgWithFallback src={text} alt="" className="h-14 w-14 rounded-lg object-cover" fallback={null} />}
                <label
                  className={cn(
                    'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-600 px-3 text-sm text-slate-300 hover:border-blue-500 focus-within:outline-2 focus-within:outline-blue-400',
                    (uploading !== null || preview) && 'pointer-events-none opacity-60',
                  )}
                >
                  <FileUp className="h-4 w-4" aria-hidden />
                  {uploading === q.id ? 'Uploading…' : text ? 'Replace image' : 'Upload image'}
                  <input
                    {...common}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    disabled={uploading !== null || preview || !uploadFile}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file || !uploadFile) return;
                      setUploading(q.id);
                      try {
                        const url = await uploadFile(file);
                        if (url) onChange(q.id, url);
                      } catch (err) {
                        toast.error(getErrorMessage(err, 'Upload failed'));
                      } finally {
                        setUploading(null);
                      }
                    }}
                  />
                </label>
              </div>
            );
            break;
        }

        const grouped = q.type === 'multiple_choice' || q.type === 'checkboxes';
        return (
          <div key={q.id}>
            {grouped ? <QuestionLabel q={q} labelId={`${q.id}-label`} /> : <QuestionLabel q={q} htmlFor={id} />}
            {q.helpText && <p id={`${id}-help`} className="text-xs text-slate-500">{q.helpText}</p>}
            <div className={grouped ? '' : 'mt-1.5'}>{control}</div>
            {error && <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-400">{error}</p>}
          </div>
        );
      })}
    </div>
  );
}
