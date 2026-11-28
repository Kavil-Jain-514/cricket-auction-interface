"use client";

import { useState } from 'react';
import { getPlayerInitials, optimizeImageUrl } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { FACE_POSITION, canFaceCrop, facePhotoUrl } from '@/lib/playerPhoto';

interface PlayerAvatarProps {
  name: string;
  photoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  className?: string;
  showBorder?: boolean;
  /**
   * Mark this as the LCP / focal image (e.g. the auction hero). Loads eagerly at
   * high fetch priority so the current player's photo paints fast on 4G, instead
   * of lingering on the initials fallback. (P1-4)
   */
  priority?: boolean;
}

const sizeClasses = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-12 h-12 text-sm',
  lg: 'w-16 h-16 text-xl',
  xl: 'w-24 h-24 text-2xl',
  '2xl': 'w-48 h-48 text-6xl',
  '3xl': 'w-108 h-108 text-8xl',
};

const sizeWidths = {
  sm: 64,
  md: 96,
  lg: 128,
  xl: 192,
  '2xl': 384,
  '3xl': 864,
};

const borderSizeClasses = {
  sm: 'border',
  md: 'border-2',
  lg: 'border-2',
  xl: 'border-3',
  '2xl': 'border-4',
  '3xl': 'border-4',
};

/**
 * Every player photo keeps the face in frame (lib/playerPhoto.ts):
 * Cloudinary photos are cropped around the face(s). Photos we can't crop
 * (Drive links) are anchored towards the top in small boxes, and shown whole
 * over a blurred copy from `xl` up, where trimming would be most visible.
 */
const WHOLE_FROM: ReadonlySet<keyof typeof sizeWidths> = new Set(['xl', '2xl', '3xl']);

/** The exact image URL PlayerAvatar requests at `size` — for preloading. */
export function playerAvatarSrc(
  photoUrl: string | null | undefined,
  size: keyof typeof sizeWidths,
): string | undefined {
  return facePhotoUrl(photoUrl, sizeWidths[size]);
}

/**
 * URLs to try in order. A face crop falls back to the plain photo if
 * Cloudinary refuses the transform, so a player never drops to initials
 * just because the crop failed.
 */
function photoCandidates(photoUrl: string | null | undefined, size: keyof typeof sizeWidths): string[] {
  const plain = optimizeImageUrl(photoUrl, sizeWidths[size]);
  const first = playerAvatarSrc(photoUrl, size);
  return [first, plain].filter((u, i, all): u is string => !!u && all.indexOf(u) === i);
}

/** The photo to show, stepping to the next candidate when one fails to load. */
function usePhotoSrc(photoUrl: string | null | undefined, size: keyof typeof sizeWidths) {
  // Keyed by URL so a failure on one player doesn't stick to the next one.
  const [failed, setFailed] = useState<string[]>([]);
  const src = photoCandidates(photoUrl, size).find((u) => !failed.includes(u));
  const onError = () => {
    if (src) setFailed((f) => [...f, src]);
  };
  return { src, onError };
}

export function PlayerAvatar({
  name,
  photoUrl,
  size = 'md',
  className,
  showBorder = true,
  priority = false,
}: PlayerAvatarProps) {
  const initials = getPlayerInitials(name);
  const { src, onError } = usePhotoSrc(photoUrl, size);
  // Photos Cloudinary can't crop are shown whole in the bigger boxes.
  const showWhole = WHOLE_FROM.has(size) && !canFaceCrop(photoUrl);
  const imgProps = {
    referrerPolicy: 'no-referrer' as const,
    fetchPriority: priority ? ('high' as const) : undefined,
    loading: priority ? ('eager' as const) : undefined,
    decoding: 'async' as const,
  };

  return (
    <div
      className={cn(
        'relative rounded-lg overflow-hidden shrink-0',
        sizeClasses[size],
        showBorder && borderSizeClasses[size],
        showBorder && 'border-slate-600',
        className
      )}
    >
      {src && showWhole ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-60" {...imgProps} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={name} className="relative w-full h-full object-contain" data-photo-fit="whole" onError={onError} {...imgProps} />
        </>
      ) : src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className={cn('w-full h-full object-cover', FACE_POSITION)} onError={onError} {...imgProps} />
      ) : (
        <div className="w-full h-full bg-linear-to-br from-blue-600 to-purple-600 flex items-center justify-center font-bold text-white">
          {initials}
        </div>
      )}
    </div>
  );
}

// Circular variant for different contexts
export function PlayerAvatarCircle({
  name,
  photoUrl,
  size = 'md',
  className,
  showBorder = true,
}: PlayerAvatarProps) {
  const initials = getPlayerInitials(name);
  const { src, onError } = usePhotoSrc(photoUrl, size);

  return (
    <div
      className={cn(
        'relative rounded-full overflow-hidden shrink-0',
        sizeClasses[size],
        showBorder && borderSizeClasses[size],
        showBorder && 'border-slate-600',
        className
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          className={cn('w-full h-full object-cover', FACE_POSITION)}
          referrerPolicy="no-referrer"
          onError={onError}
        />
      ) : (
        <div className="w-full h-full bg-linear-to-br from-blue-600 to-purple-600 flex items-center justify-center font-bold text-white">
          {initials}
        </div>
      )}
    </div>
  );
}
