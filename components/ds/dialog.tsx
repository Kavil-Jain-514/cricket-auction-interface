"use client"

// components/ds/dialog.tsx - Floodlight dialog and sheet on Radix Dialog
// (focus trap, Escape, scroll lock, aria wiring). The sheet is the same
// primitive docked to the bottom (phones) or the right (projector consoles).
import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close

function Overlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-canvas/70 backdrop-blur-sm duration-(--dur-slow) data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function CloseButton() {
  return (
    <DialogPrimitive.Close
      className="fl-focus absolute top-3 right-3 inline-flex size-11 items-center justify-center rounded-control text-ink-muted transition-colors duration-(--dur-fast) hover:bg-raised hover:text-ink"
    >
      <XIcon className="size-5" />
      <span className="sr-only">Close</span>
    </DialogPrimitive.Close>
  )
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-panel border border-line bg-surface p-6 text-ink shadow-floating duration-(--dur-slow) data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        <CloseButton />
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

const sheetSides = {
  bottom:
    "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-panel border-t pb-[max(1.5rem,env(safe-area-inset-bottom))] data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
  right:
    "inset-y-0 right-0 h-full w-full max-w-md border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
}

function SheetContent({
  className,
  children,
  side = "bottom",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { side?: keyof typeof sheetSides }) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        className={cn(
          "fixed z-50 flex flex-col gap-4 overflow-y-auto border-line bg-surface p-6 text-ink shadow-floating duration-(--dur-slow) ease-floodlight data-[state=open]:animate-in data-[state=closed]:animate-out",
          sheetSides[side],
          className
        )}
        {...props}
      >
        {side === "bottom" && (
          <div aria-hidden className="mx-auto -mt-2 h-1.5 w-12 rounded-full bg-line-strong" />
        )}
        {children}
        <CloseButton />
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("pr-12 font-head text-2xl font-bold uppercase tracking-wide", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-ink-muted", className)} {...props} />
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Dialog as Sheet,
  DialogTrigger as SheetTrigger,
  SheetContent,
  DialogTitle as SheetTitle,
  DialogDescription as SheetDescription,
}
