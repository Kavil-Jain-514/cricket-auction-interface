import { Trophy } from 'lucide-react';
import { ImgWithFallback } from '@/components/ui/img-with-fallback';
import { cn } from '@/lib/utils';

type Props = {
  name: string;
  description?: string;
  logoUrl?: string;
  organizationLogoUrl?: string;
  className?: string;
};

const logoCls = 'h-20 w-20 shrink-0 rounded-2xl border border-slate-700 bg-slate-900 object-contain p-1 shadow-lg sm:h-24 sm:w-24';

function Logo({ src, alt }: { src: string; alt: string }) {
  return (
    <ImgWithFallback
      src={src}
      alt={alt}
      className={logoCls}
      fallback={<div className={cn(logoCls, 'flex items-center justify-center')}><Trophy className="h-10 w-10 text-yellow-500" aria-hidden /></div>}
    />
  );
}

/**
 * The registration form's title block: the tournament logo on the left, the
 * organisation logo on the right, the name between them. On phones both logos
 * sit side by side above the name. With one logo it is centred above the name.
 */
export function RegistrationHeader({ name, description, logoUrl, organizationLogoUrl, className }: Props) {
  const both = Boolean(logoUrl && organizationLogoUrl);
  const title = (
    <div className="min-w-0 text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-blue-300">Player registration</p>
      <h1 className="text-2xl font-extrabold break-words sm:text-3xl">{name}</h1>
      {description && <p className="mt-1 text-sm text-slate-300 line-clamp-3">{description}</p>}
    </div>
  );

  if (both) {
    return (
      <div className={cn('px-5 pt-6 pb-5', className)}>
        {/* Phones: logos side by side, then the name. */}
        <div className="flex flex-col items-center gap-3 sm:hidden">
          <div className="flex items-center justify-center gap-4">
            <Logo src={logoUrl!} alt={`${name} logo`} />
            <Logo src={organizationLogoUrl!} alt="Organiser logo" />
          </div>
          {title}
        </div>
        {/* Wider: tournament logo | name | organisation logo. */}
        <div className="hidden grid-cols-[auto_1fr_auto] items-center gap-5 sm:grid">
          <Logo src={logoUrl!} alt={`${name} logo`} />
          {title}
          <Logo src={organizationLogoUrl!} alt="Organiser logo" />
        </div>
      </div>
    );
  }

  const only = logoUrl || organizationLogoUrl;
  return (
    <div className={cn('flex flex-col items-center gap-3 px-5 pt-6 pb-5', className)}>
      {only ? (
        <Logo src={only} alt={logoUrl ? `${name} logo` : 'Organiser logo'} />
      ) : (
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-yellow-500/15 sm:h-24 sm:w-24">
          <Trophy className="h-12 w-12 text-yellow-500" aria-hidden />
        </div>
      )}
      {title}
    </div>
  );
}
