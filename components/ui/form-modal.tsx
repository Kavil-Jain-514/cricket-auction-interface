"use client";

import type { ComponentType, FormEvent, ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

// The Add Player form's look, shared by every form: an icon header, a compact
// body and a footer with Cancel and the primary action.

type IconType = ComponentType<{ className?: string }>;

const WIDTHS = {
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
} as const;

export interface FormShellProps {
  icon: IconType;
  title: string;
  subtitle?: string;
  /** Close button in the header; omit on a page. */
  onClose?: () => void;
  onSubmit?: (e: FormEvent) => void;
  /** Tabs or steps, shown under the title. */
  nav?: ReactNode;
  /** Replaces the default Cancel + submit footer. */
  footer?: ReactNode;
  submitLabel?: string;
  loadingLabel?: string;
  loading?: boolean;
  submitDisabled?: boolean;
  cancelLabel?: string;
  onCancel?: () => void;
  width?: keyof typeof WIDTHS;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

/** The form card itself, for use on a page or inside FormModal. */
export function FormShell({
  icon: Icon,
  title,
  subtitle,
  onClose,
  onSubmit,
  nav,
  footer,
  submitLabel = 'Save',
  loadingLabel = 'Saving…',
  loading = false,
  submitDisabled = false,
  cancelLabel = 'Cancel',
  onCancel,
  width = '3xl',
  className,
  bodyClassName,
  children,
}: FormShellProps) {
  const cancel = onCancel ?? onClose;
  return (
    <form
      onSubmit={onSubmit ?? ((e) => e.preventDefault())}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 text-white shadow-2xl',
        WIDTHS[width],
        className,
      )}
    >
      <div className="relative shrink-0 border-b border-slate-800 bg-linear-to-r from-blue-600/20 via-slate-900 to-purple-600/10 px-5 py-3.5 sm:px-6">
        <div className="flex items-center gap-3 pr-10">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 ring-1 ring-blue-500/30">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold leading-tight text-white sm:text-xl">{title}</h2>
            {subtitle && <p className="truncate text-xs text-slate-400 sm:text-sm">{subtitle}</p>}
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        )}
        {nav && <div className="mt-3">{nav}</div>}
      </div>

      {/* Sized to fit; scrolls only on very short screens. */}
      <div className={cn('min-h-0 flex-1 overflow-y-auto ipad-scroll px-5 py-4 sm:px-6', bodyClassName)}>{children}</div>

      <div className="shrink-0 border-t border-slate-800 bg-slate-900/95 px-5 py-3 sm:px-6">
        {footer ?? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            {cancel && (
              <Button type="button" variant="outline" onClick={cancel} className="h-10 sm:min-w-28">
                {cancelLabel}
              </Button>
            )}
            <Button type="submit" disabled={loading || submitDisabled} className="h-10 sm:min-w-36">
              {loading ? (
                <>
                  <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  {loadingLabel}
                </>
              ) : (
                submitLabel
              )}
            </Button>
          </div>
        )}
      </div>
    </form>
  );
}

/** FormShell in a dimmed overlay; clicking outside closes it. */
export function FormModal(props: FormShellProps & { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-4"
      onClick={props.onClose}
    >
      <FormShell {...props} />
    </div>
  );
}

/** Pill tabs for a FormShell's `nav`, with an error dot per tab. */
export function FormTabs<K extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: ReadonlyArray<{ key: K; label: string; error?: boolean }>;
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto rounded-lg bg-slate-800/80 p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            'flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold transition',
            value === t.key ? 'bg-slate-950 text-white shadow' : 'text-slate-400 hover:text-white',
          )}
        >
          {t.label}
          {t.error && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-red-500" aria-label="has errors" />}
        </button>
      ))}
    </div>
  );
}

/** Numbered steps for a FormShell's `nav`. */
export function FormSteps({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2 text-xs sm:text-sm">
      {steps.map((label, i) => (
        <li key={label} className="flex items-center gap-2">
          {i > 0 && <span className={cn('h-px w-6 sm:w-10', i <= current ? 'bg-blue-500' : 'bg-slate-700')} />}
          <span
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
              i < current ? 'bg-green-600 text-white' : i === current ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400',
            )}
          >
            {i + 1}
          </span>
          <span className={i === current ? 'font-medium text-white' : 'text-slate-400'}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

export function SectionHeading({ icon: Icon, title, hint }: { icon: IconType; title: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-blue-400">
        <Icon className="h-4 w-4" />
      </div>
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      {hint && <span className="text-xs text-slate-500">· {hint}</span>}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string | null;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} className="text-slate-300">{label}</Label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p className="mt-1 text-xs text-red-400">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export const FormDivider = () => <div className="h-px bg-slate-800" />;

/** Input class used across the forms. */
export const formInputCls = 'h-10 text-base md:text-sm';
