"use client";

import { Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

interface ShareResultsButtonProps {
  tournamentId: string;
  tournamentName: string;
  className?: string;
}

/**
 * Shares the public /results page: the phone's share sheet (WhatsApp is one
 * tap) where available, else copies the link.
 */
export function ShareResultsButton({ tournamentId, tournamentName, className }: ShareResultsButtonProps) {
  const handleShare = async () => {
    const url = `${window.location.origin}/results/${tournamentId}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: `${tournamentName} — auction results`, url });
        return;
      } catch (error) {
        if ((error as Error).name === 'AbortError') return; // closed the sheet
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Results link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  };

  return (
    <Button
      onClick={handleShare}
      variant="outline"
      className={className ?? 'border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white h-11 px-4 sm:px-5 text-sm'}
    >
      <Share2 className="w-4 h-4 mr-2" />
      Share results
    </Button>
  );
}
