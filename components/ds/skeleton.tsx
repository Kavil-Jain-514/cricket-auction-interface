// components/ds/skeleton.tsx - Loading placeholder with a slow shimmer
// (static under prefers-reduced-motion). Size it like the content it stands
// in for so nothing shifts when data arrives (CLS).
import { cn } from "@/lib/utils"

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-fl-shimmer rounded-control bg-[linear-gradient(90deg,var(--fl-raised)_0%,var(--fl-surface)_50%,var(--fl-raised)_100%)] bg-size-[200%_100%]",
        className
      )}
      {...props}
    />
  )
}
