// components/ds/logo.tsx - The Bid11Pro wordmark: a floodlit ball (seam in
// the signal accent) and the name in the display face. One logo for the
// marketing site and the app.
import { cn } from "@/lib/utils"

const sizes = {
  md: { ball: "size-8", text: "text-2xl" },
  sm: { ball: "size-6", text: "text-xl" },
}

export function Logo({ size = "md", className }: { size?: keyof typeof sizes; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-ink", className)}>
      <svg viewBox="0 0 32 32" className={cn("shrink-0", sizes[size].ball)} aria-hidden>
        <circle cx="16" cy="16" r="14" fill="#d22f2f" />
        <path d="M6 16q5-7 10 0t10 0" fill="none" stroke="var(--fl-signal)" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M6 16q5 7 10 0t10 0" fill="none" stroke="#fff" strokeOpacity=".75" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      <span className={cn("font-head leading-none font-bold tracking-wide uppercase", sizes[size].text)}>
        Bid<span className="text-signal">11</span>Pro
      </span>
    </span>
  )
}
