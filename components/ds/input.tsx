// components/ds/input.tsx - Floodlight text input and textarea. 44 px tall,
// a 3:1 border (line-strong) so the field edge is visible, unsold on error.
import * as React from "react"

import { cn } from "@/lib/utils"

const fieldClasses =
  "fl-focus w-full min-w-0 rounded-control border border-line-strong bg-surface px-3.5 text-base text-ink placeholder:text-ink-muted transition-[border-color,box-shadow] duration-(--dur-fast) ease-floodlight hover:border-ink-muted disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-unsold aria-invalid:focus-visible:ring-unsold"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(fieldClasses, "h-11", className)}
      {...props}
    />
  )
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldClasses, "min-h-28 py-2.5", className)}
      {...props}
    />
  )
}

function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string
  hint?: string
  error?: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-sm text-unsold">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export { Input, Textarea, Field }
