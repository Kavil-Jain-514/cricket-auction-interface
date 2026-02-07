"use client";

import { useState } from 'react';
import { cn } from '@/lib/utils';

interface TeamLogoProps {
  name: string;
  logoUrl?: string | null;
  primaryColor?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showBorder?: boolean;
  rounded?: 'sm' | 'md' | 'lg' | 'full';
}

const sizeClasses = {
  sm: 'w-8 h-8 text-sm',
  md: 'w-12 h-12 text-lg',
  lg: 'w-16 h-16 text-2xl',
  xl: 'w-24 h-24 text-4xl',
};

const borderSizeClasses = {
  sm: 'border',
  md: 'border-2',
  lg: 'border-2',
  xl: 'border-3',
};

const roundedClasses = {
  sm: 'rounded',
  md: 'rounded-lg',
  lg: 'rounded-xl',
  full: 'rounded-full',
};

export function TeamLogo({ 
  name, 
  logoUrl, 
  primaryColor = '#3B82F6',
  size = 'md', 
  className,
  showBorder = true,
  rounded = 'lg',
}: TeamLogoProps) {
  const [imageError, setImageError] = useState(false);
  const hasValidLogo = logoUrl && !imageError;
  const initial = name.charAt(0).toUpperCase();

  return (
    <div 
      className={cn(
        'relative overflow-hidden shrink-0 flex items-center justify-center',
        sizeClasses[size],
        roundedClasses[rounded],
        showBorder && borderSizeClasses[size],
        showBorder && 'border-slate-600',
        className
      )}
      style={!hasValidLogo ? { backgroundColor: primaryColor } : undefined}
    >
      {hasValidLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={`${name} logo`}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setImageError(true)}
        />
      ) : (
        <span className="font-bold text-white drop-shadow-md">
          {initial}
        </span>
      )}
    </div>
  );
}
