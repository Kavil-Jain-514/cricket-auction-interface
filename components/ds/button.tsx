// components/ds/button.tsx - Floodlight button. Every size is at least 44 px
// tall (WCAG 2.5.5 target size) and shares the one .fl-focus ring.
import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "fl-focus inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-control font-semibold transition-[background-color,color,box-shadow,transform] duration-(--dur-fast) ease-floodlight active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        primary: "bg-signal text-signal-ink hover:shadow-glow",
        secondary: "border border-line-strong bg-raised text-ink hover:border-ink-muted",
        ghost: "text-ink hover:bg-raised",
        danger: "bg-unsold text-canvas hover:brightness-110",
        link: "text-signal underline-offset-4 hover:underline",
      },
      size: {
        md: "h-11 px-5 text-base",
        lg: "h-14 px-7 text-lg",
        icon: "size-11",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
