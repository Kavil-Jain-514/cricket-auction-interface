"use client";

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { FastForward, PartyPopper } from 'lucide-react';
import { Doc, Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { TeamLogo } from '@/components/ui/team-logo';
import { cn } from '@/lib/utils';

type Assignment = Doc<"groupDraws">["assignments"][number];

interface GroupDrawRevealProps {
  /** The already-decided, persisted draw result. The animation only presents it. */
  assignments: Assignment[];
  teamsById: Map<Id<"teams">, Doc<"teams">>;
  onComplete: () => void;
}

const SHUFFLE_MS = 2200; // opening shuffle phase
const CYCLE_MS = 90; // how fast names cycle in the spinner
const LOCK_AT_MS = 950; // when the drawn team locks in within a slot window
const SLOT_MS = 1600; // total time per slot reveal

/**
 * Draw-ceremony overlay: a shuffling phase, then a suspenseful slot-by-slot
 * reveal into the group table, finishing with confetti. The result is fully
 * decided before this component mounts — skipping just jumps to the end.
 */
export function GroupDrawReveal({ assignments, teamsById, onComplete }: GroupDrawRevealProps) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<'shuffle' | 'reveal' | 'done'>('shuffle');
  const [current, setCurrent] = useState(0); // index of the slot being revealed
  const [locked, setLocked] = useState(false); // current slot's team revealed?
  const [cycleIdx, setCycleIdx] = useState(0);

  const teamName = (id: Id<"teams">) => teamsById.get(id)?.name ?? 'Team';

  // Assignment order is already random, so cycling through it reads as a shuffle
  const cycleNames = useMemo(
    () => assignments.map((a) => teamName(a.teamId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assignments, teamsById],
  );

  const groups = useMemo(() => {
    const map = new Map<string, { assignment: Assignment; index: number }[]>();
    assignments.forEach((assignment, index) => {
      const slots = map.get(assignment.group) ?? [];
      slots.push({ assignment, index });
      map.set(assignment.group, slots);
    });
    return [...map.entries()];
  }, [assignments]);

  // Reduced motion: no ceremony — show the completed table with a plain fade
  useEffect(() => {
    if (reduceMotion) {
      setCurrent(assignments.length);
      setPhase('done');
    }
  }, [reduceMotion, assignments.length]);

  // Name spinner
  const cycling = phase === 'shuffle' || (phase === 'reveal' && !locked);
  useEffect(() => {
    if (!cycling) return;
    const id = setInterval(() => setCycleIdx((i) => i + 1), CYCLE_MS);
    return () => clearInterval(id);
  }, [cycling]);

  // Shuffle phase → reveal phase
  useEffect(() => {
    if (phase !== 'shuffle' || reduceMotion) return;
    const id = setTimeout(() => setPhase('reveal'), SHUFFLE_MS);
    return () => clearTimeout(id);
  }, [phase, reduceMotion]);

  // Slot-by-slot reveal loop
  useEffect(() => {
    if (phase !== 'reveal') return;
    if (current >= assignments.length) {
      setPhase('done');
      return;
    }
    setLocked(false);
    const lockTimer = setTimeout(() => setLocked(true), LOCK_AT_MS);
    const nextTimer = setTimeout(() => setCurrent((c) => c + 1), SLOT_MS);
    return () => {
      clearTimeout(lockTimer);
      clearTimeout(nextTimer);
    };
  }, [phase, current, assignments.length]);

  // Celebration
  useEffect(() => {
    if (phase !== 'done' || reduceMotion) return;
    confetti({ particleCount: 120, spread: 80, origin: { x: 0.2, y: 0.6 } });
    confetti({ particleCount: 120, spread: 80, origin: { x: 0.8, y: 0.6 } });
  }, [phase, reduceMotion]);

  const handleSkip = () => {
    setCurrent(assignments.length);
    setLocked(false);
    setPhase('done');
  };

  const currentAssignment = phase === 'reveal' ? assignments[current] : undefined;
  const isFilled = (index: number) =>
    phase === 'done' || index < current || (index === current && locked);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-100 bg-linear-to-br from-slate-950 via-indigo-950 to-slate-950 overflow-y-auto"
    >
      {/* Ambient glow */}
      {!reduceMotion && (
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <motion.div
            className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/15 rounded-full blur-3xl"
            animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
            transition={{ duration: 3, repeat: Infinity }}
          />
          <motion.div
            className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/15 rounded-full blur-3xl"
            animate={{ scale: [1.2, 1, 1.2], opacity: [0.5, 0.3, 0.5] }}
            transition={{ duration: 3, repeat: Infinity }}
          />
        </div>
      )}

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 min-h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 sm:mb-8">
          <h1 className="text-xl sm:text-3xl font-bold text-white">
            {phase === 'done' ? 'Draw Complete!' : 'Group Draw'}
          </h1>
          {phase !== 'done' && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSkip}
              className="h-10 px-4 border-slate-600 text-slate-300 hover:bg-slate-800"
            >
              <FastForward className="w-4 h-4 mr-2" />
              Skip animation
            </Button>
          )}
        </div>

        {/* Center stage: spinner / current pick */}
        <AnimatePresence>
          {phase !== 'done' && (
            <motion.div
              exit={{ opacity: 0, height: 0 }}
              className="text-center mb-6 sm:mb-10"
            >
              <div className="text-xs sm:text-sm uppercase tracking-[0.25em] text-slate-400 mb-3">
                {phase === 'shuffle'
                  ? 'Shuffling teams…'
                  : `Drawing slot ${currentAssignment?.slotLabel ?? ''}`}
              </div>
              <div className="h-24 sm:h-28 flex items-center justify-center">
                {phase === 'reveal' && locked && currentAssignment ? (
                  <motion.div
                    key={`locked-${current}`}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                    className="inline-flex items-center gap-3 sm:gap-4 px-6 sm:px-8 py-3 sm:py-4 bg-linear-to-r from-blue-600 to-purple-600 rounded-2xl shadow-2xl shadow-blue-500/30"
                  >
                    <TeamLogo
                      name={teamName(currentAssignment.teamId)}
                      logoUrl={teamsById.get(currentAssignment.teamId)?.logoUrl}
                      primaryColor={teamsById.get(currentAssignment.teamId)?.colorPrimary}
                      size="md"
                      rounded="full"
                    />
                    <span className="text-2xl sm:text-4xl font-bold text-white">
                      {teamName(currentAssignment.teamId)}
                    </span>
                  </motion.div>
                ) : (
                  <div className="inline-flex items-center px-6 sm:px-8 py-3 sm:py-4 bg-slate-800/70 border border-slate-600 rounded-2xl">
                    <span className="text-2xl sm:text-4xl font-bold text-slate-300 tabular-nums">
                      {cycleNames[cycleIdx % Math.max(cycleNames.length, 1)] ?? '…'}
                    </span>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Group grid filling in slot by slot */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {groups.map(([group, slots]) => (
            <div key={group} className="bg-slate-900/70 border border-slate-700 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-800/80 border-b border-slate-700">
                <h3 className="font-bold text-white">Group {group}</h3>
              </div>
              <ul className="divide-y divide-slate-800">
                {slots.map(({ assignment, index }) => {
                  const team = teamsById.get(assignment.teamId);
                  const filled = isFilled(index);
                  const isActive = phase === 'reveal' && index === current && !locked;
                  return (
                    <li
                      key={assignment.slotLabel}
                      className={cn(
                        'flex items-center gap-3 px-4 py-2.5 min-h-[52px]',
                        isActive && 'bg-blue-500/10 ring-1 ring-inset ring-blue-500/50',
                      )}
                    >
                      <span
                        className={cn(
                          'w-10 shrink-0 text-center text-xs font-bold rounded-md py-1',
                          filled
                            ? 'text-blue-400 bg-blue-500/10 border border-blue-500/30'
                            : 'text-slate-500 border border-dashed border-slate-600',
                        )}
                      >
                        {assignment.slotLabel}
                      </span>
                      {filled ? (
                        <motion.div
                          initial={reduceMotion ? false : { opacity: 0, x: -12, scale: 0.9 }}
                          animate={{ opacity: 1, x: 0, scale: 1 }}
                          transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                          className="flex items-center gap-2.5 min-w-0"
                        >
                          <TeamLogo
                            name={team?.name ?? '?'}
                            logoUrl={team?.logoUrl}
                            primaryColor={team?.colorPrimary}
                            size="sm"
                          />
                          <span className="font-semibold text-sm text-white truncate">
                            {team?.name ?? 'Unknown team'}
                          </span>
                        </motion.div>
                      ) : (
                        <span className={cn('text-sm', isActive ? 'text-blue-300 animate-pulse' : 'text-slate-600')}>
                          {isActive ? 'Drawing…' : 'Awaiting draw'}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        {/* Final state */}
        <AnimatePresence>
          {phase === 'done' && (
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center mt-8 pb-6"
            >
              <p className="text-slate-300 mb-4 flex items-center justify-center gap-2">
                <PartyPopper className="w-5 h-5 text-yellow-400" />
                All {assignments.length} teams have been allotted to their groups.
              </p>
              <Button onClick={onComplete} className="h-11 px-6">
                View Groups
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
