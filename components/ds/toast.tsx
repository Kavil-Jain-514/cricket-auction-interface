"use client"

// components/ds/toast.tsx - Floodlight-themed sonner Toaster. Only /design
// mounts it in this step; PR (b) swaps it in for the one in app/providers.tsx.
import { Toaster } from "sonner"

export function AppToaster() {
  return (
    <Toaster
      position="top-center"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-start gap-3 rounded-card border border-line bg-raised p-4 text-ink shadow-floating",
          title: "font-semibold",
          description: "text-sm text-ink-muted",
          success: "border-l-4 border-l-sold",
          error: "border-l-4 border-l-unsold",
          warning: "border-l-4 border-l-timer",
          info: "border-l-4 border-l-signal",
        },
      }}
    />
  )
}

export { toast } from "sonner"
