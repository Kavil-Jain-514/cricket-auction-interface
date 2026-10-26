"use client";

import { categoryFor, type PlayerCategory } from '@/convex/bidRules';
import { cn } from '@/lib/utils';

interface CategoryChipProps {
  categoryId?: string;
  categories?: PlayerCategory[];
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm',
  lg: 'px-4 py-2 lg:px-5 lg:py-2.5 text-sm sm:text-base lg:text-lg',
};

/** Coloured category pill (e.g. "Marquee"). Renders nothing without a category. */
export function CategoryChip({ categoryId, categories, size = 'sm', className }: CategoryChipProps) {
  const category = categoryFor(categoryId, categories);
  if (!category) return null;
  return (
    <span
      className={cn('inline-flex items-center rounded-full font-semibold text-white', SIZES[size], className)}
      style={{ backgroundColor: category.colour }}
    >
      {category.name}
    </span>
  );
}
