import * as React from "react"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * A native <select> styled like Input: dark field, custom chevron, focus
 * ring and dark option list. Native so it stays fast and phone-friendly.
 */
function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className={cn("relative w-full", className)}>
      <select
        data-slot="native-select"
        className={cn(
          "h-full min-h-9 w-full cursor-pointer appearance-none rounded-md border border-slate-600 bg-slate-800 py-1 pr-9 pl-3 text-base text-white shadow-xs transition-[color,box-shadow,border-color] outline-none md:text-sm",
          "hover:border-slate-500 focus-visible:border-blue-500 focus-visible:ring-[3px] focus-visible:ring-blue-500/30",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "[&>option]:bg-slate-800 [&>option]:text-white [&>optgroup]:bg-slate-800",
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-slate-400"
      />
    </div>
  )
}

export { NativeSelect }
