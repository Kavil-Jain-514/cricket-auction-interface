"use client";

import { useState } from 'react';
import { getPlayerInitials } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface PlayerAvatarProps {
  name: string;
  photoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
  showBorder?: boolean;
}

const sizeClasses = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-12 h-12 text-sm',
  lg: 'w-16 h-16 text-xl',
  xl: 'w-24 h-24 text-2xl',
  '2xl': 'w-48 h-48 text-6xl',
};

const borderSizeClasses = {
  sm: 'border',
  md: 'border-2',
  lg: 'border-2',
  xl: 'border-3',
  '2xl': 'border-4',
};

export function PlayerAvatar({ 
  name, 
  photoUrl, 
  size = 'md', 
  className,
  showBorder = true,
}: PlayerAvatarProps) {
  const [imageError, setImageError] = useState(false);
  const initials = getPlayerInitials(name);
  const hasValidPhoto = photoUrl && !imageError;

  return (
    <div 
      className={cn(
        'relative rounded-lg overflow-hidden flex-shrink-0',
        sizeClasses[size],
        showBorder && borderSizeClasses[size],
        showBorder && 'border-slate-600',
        className
      )}
    >
      {hasValidPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt={name}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setImageError(true)}
        />
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
  const [imageError, setImageError] = useState(false);
  const initials = getPlayerInitials(name);
  const hasValidPhoto = photoUrl && !imageError;

  return (
    <div 
      className={cn(
        'relative rounded-full overflow-hidden flex-shrink-0',
        sizeClasses[size],
        showBorder && borderSizeClasses[size],
        showBorder && 'border-slate-600',
        className
      )}
    >
      {hasValidPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt={name}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setImageError(true)}
        />
      ) : (
        <div className="w-full h-full bg-linear-to-br from-blue-600 to-purple-600 flex items-center justify-center font-bold text-white">
          {initials}
        </div>
      )}
    </div>
  );
}
