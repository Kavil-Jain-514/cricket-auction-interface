"use client";

import { useState } from 'react';

interface ImgWithFallbackProps {
  src?: string | null;
  alt: string;
  className?: string;
  /** Rendered when src is missing OR the image fails to load (dead URL). */
  fallback: React.ReactNode;
  referrerPolicy?: React.HTMLAttributeReferrerPolicy;
  loading?: 'lazy' | 'eager';
  /** Responsive candidates, e.g. Cloudinary widths for 1x / 2x screens. */
  srcSet?: string;
  sizes?: string;
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
  loading,
  srcSet,
  sizes,
}: ImgWithFallbackProps) {
  // Track *which* src failed rather than a boolean. The error state then clears
  // automatically when `src` changes (a different src won't match `erroredSrc`),
  // so there is no render-phase setState and setState only runs in onError.
  const [erroredSrc, setErroredSrc] = useState<string | null>(null);

  if (!src || erroredSrc === src) {
    return <>{fallback}</>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      referrerPolicy={referrerPolicy}
      loading={loading}
      srcSet={srcSet}
      sizes={sizes}
      decoding="async"
      onError={() => setErroredSrc(src)}
    />
  );
}
