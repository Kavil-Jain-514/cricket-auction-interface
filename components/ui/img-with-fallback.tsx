"use client";

import { useState } from 'react';

interface ImgWithFallbackProps {
  src?: string | null;
  alt: string;
  className?: string;
  /** Rendered when src is missing OR the image fails to load (dead URL). */
  fallback: React.ReactNode;
  referrerPolicy?: React.HTMLAttributeReferrerPolicy;
}

/**
 * Image that falls back to `fallback` both when there is no `src` and when the
 * `src` fails to load (e.g. a dead Cloudinary URL). The error state resets
 * whenever `src` changes, so it is safe to reuse across players/results.
 */
export function ImgWithFallback({
  src,
  alt,
  className,
  fallback,
  referrerPolicy = 'no-referrer',
}: ImgWithFallbackProps) {
  const [error, setError] = useState(false);
  // Reset the error flag when src changes (React's "adjust state during render"
  // pattern) so the component is safe to reuse across players/results without
  // a stale error suppressing a valid new image.
  const [prevSrc, setPrevSrc] = useState(src);
  if (src !== prevSrc) {
    setPrevSrc(src);
    setError(false);
  }

  if (!src || error) {
    return <>{fallback}</>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      referrerPolicy={referrerPolicy}
      onError={() => setError(true)}
    />
  );
}
