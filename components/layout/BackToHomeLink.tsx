import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * "Back to home" for pages without the Navbar (sign-in, sign-up, onboarding).
 * A plain <a>, not next/link: it leaves the app shell for the static
 * marketing one, so a full load is right, and rendering next/link from the
 * sign-in pages re-splits the chunks the marketing pages share, breaking
 * their Lighthouse script budget (lighthouserc.json).
 */
export function BackToHomeLink({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-html-link-for-pages -- see above
    <a
      href="/"
      className={cn(
        "fl-focus inline-flex min-h-11 w-fit items-center gap-2 rounded-control px-2 text-sm text-slate-400 transition hover:text-white",
        className,
      )}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Back to home
    </a>
  );
}
