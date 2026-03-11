"use client";

import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

export interface AuctionLiveBidsProps {
  recentBids: Array<{ _id: string; teamId: string; amount: number; timestamp: number }> | undefined;
  teams: Array<{ _id: string; name: string }> | undefined;
  currentPlayer: { basePrice?: number } | null | undefined;
  isFirstBid: boolean;
  minNextBid: number;
  totalBidsCount: number;
  tournamentBasePrice: number;
}

export function AuctionLiveBids({
  recentBids,
  teams,
  currentPlayer,
  isFirstBid,
  minNextBid,
  totalBidsCount,
  tournamentBasePrice,
}: AuctionLiveBidsProps) {
  return (
    <aside className="col-span-12 lg:col-span-2 order-3">
      <h3 className="text-base sm:text-lg font-semibold flex items-center gap-2 mb-3 sm:mb-4">
        <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5" />
        Live Bids
      </h3>

      <div className="space-y-2">
        {!recentBids || recentBids.length === 0 ? (
          <div className="text-center py-6 sm:py-8 text-slate-500">
            <p className="text-sm">No bids yet</p>
            <p className="text-xs mt-1">
              {isFirstBid ? 'First bid starts at base price' : 'Waiting for bids...'}
            </p>
          </div>
        ) : (
          <AnimatePresence>
            {recentBids.slice(0, 5).map((bid, idx) => (
              <motion.div
                key={bid._id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ delay: idx * 0.05 }}
                className="bg-slate-800/70 backdrop-blur rounded-lg p-2.5 sm:p-3 border border-slate-700"
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs sm:text-sm font-semibold truncate">
                    {teams?.find((t) => t._id === bid.teamId)?.name}
                  </span>
                  <span className="text-xs text-slate-400">
                    {new Date(bid.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-base sm:text-lg font-bold text-yellow-400">
                  {formatCurrency(bid.amount)}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Quick Stats */}
      {currentPlayer && (
        <div className="mt-6 sm:mt-8 bg-slate-800/50 rounded-lg p-3 sm:p-4 border border-slate-700">
          <h4 className="font-semibold mb-2 sm:mb-3 text-sm">Player Info</h4>
          <div className="space-y-2 sm:space-y-3">
            <div className="flex justify-between text-xs sm:text-sm">
              <span className="text-slate-400">Base Price</span>
              <span className="font-semibold">
                {formatCurrency(currentPlayer.basePrice ?? tournamentBasePrice)}
              </span>
            </div>
            <div className="flex justify-between text-xs sm:text-sm">
              <span className="text-slate-400">Next Bid</span>
              <span className="font-semibold text-green-400">
                {formatCurrency(
                  isFirstBid ? (currentPlayer.basePrice ?? tournamentBasePrice) : minNextBid
                )}
              </span>
            </div>
            <div className="flex justify-between text-xs sm:text-sm">
              <span className="text-slate-400">Total Bids</span>
              <span className="font-semibold">{totalBidsCount}</span>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
