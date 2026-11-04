import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** "Back to home" for pages without the Navbar (sign-in, sign-up, onboarding). */
export function BackToHomeLink({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "fl-focus inline-flex min-h-11 w-fit items-center gap-2 rounded-control px-2 text-sm text-slate-400 transition hover:text-white",
        className,
      )}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Back to home
    </Link>
  );
}
