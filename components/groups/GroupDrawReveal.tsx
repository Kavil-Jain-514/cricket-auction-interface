"use client";

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import confetti from 'canvas-confetti';
import { FastForward, PartyPopper, ArrowRight, Sparkles } from 'lucide-react';
import { Doc, Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { TeamLogo } from '@/components/ui/team-logo';
import { cn } from '@/lib/utils';
import { fisherYatesShuffle } from '@/lib/groupDraw';

type Assignment = Doc<"groupDraws">["assignments"][number];

interface GroupDrawRevealProps {
  /** The already-decided, persisted draw result. The animation only presents it. */
  assignments: Assignment[];
  teamsById: Map<Id<"teams">, Doc<"teams">>;
  onComplete: () => void;
}

// Ceremony timing (ms)
const INTRO_MS = 1400; // opening shuffle
const CYCLE_MS = 80; // how fast names flicker in the spinner
const TEAM_SPIN_MS = 1000; // drumroll before a team locks in
const TEAM_HOLD_MS = 700; // hold on the drawn team before revealing its group
const GROUP_HOLD_MS = 1150; // hold on the group reveal before the next team

type Phase = 'intro' | 'pick' | 'done';
type Sub = 'spin' | 'team' | 'group';

// Per-group accent hue so each group reads as its own identity.
const GROUP_HUES = [210, 265, 150, 25, 330, 190, 45, 285, 0, 170];
function groupAccent(group: string): string {
  const i = Math.max(0, group.charCodeAt(0) - 65);
  return `hsl(${GROUP_HUES[i % GROUP_HUES.length]} 80% 58%)`;
}

/**
 * Draw-ceremony overlay. The result is fully decided before this mounts — the
 * ceremony reveals it in a random *team* order: each team is spotlighted on its
 * own, then dramatically assigned to its group. Skipping jumps to the end.
 */
export function GroupDrawReveal({ assignments, teamsById, onComplete }: GroupDrawRevealProps) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('intro');
  const [sub, setSub] = useState<Sub>('spin');
  const [step, setStep] = useState(0); // index into revealOrder
  const [cycleIdx, setCycleIdx] = useState(0);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());

  const teamName = (id: Id<"teams">) => teamsById.get(id)?.name ?? 'Team';

  // Random order in which teams get drawn (indices into `assignments`). The
  // outcome is unchanged — only the reveal sequence is shuffled — so groups
  // fill in unpredictably, which is what makes it exciting to watch.
  const revealOrder = useMemo(
    () => fisherYatesShuffle(assignments.map((_, i) => i)),
    [assignments],
  );

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

  const currentIndex = revealOrder[step];
  const currentAssignment = phase === 'pick' ? assignments[currentIndex] : undefined;
  const currentTeam = currentAssignment ? teamsById.get(currentAssignment.teamId) : undefined;
  const activeGroup = phase === 'pick' && sub !== 'spin' ? currentAssignment?.group : undefined;

  // Reduced motion: skip the ceremony, show the finished table.
  useEffect(() => {
    if (reduceMotion) {
      setRevealed(new Set(assignments.map((_, i) => i)));
      setPhase('done');
    }
  }, [reduceMotion, assignments]);

  // Name spinner ticks during the intro and every team's drumroll.
  const cycling = phase === 'intro' || (phase === 'pick' && sub === 'spin');
  useEffect(() => {
    if (!cycling) return;
    const id = setInterval(() => setCycleIdx((i) => i + 1), CYCLE_MS);
    return () => clearInterval(id);
  }, [cycling]);

  // Main state machine: intro → per-team (spin → team → group) → done.
  useEffect(() => {
    if (reduceMotion) return;
    if (phase === 'intro') {
      const t = setTimeout(() => { setPhase('pick'); setStep(0); setSub('spin'); }, INTRO_MS);
      return () => clearTimeout(t);
    }
    if (phase !== 'pick') return;
    if (sub === 'spin') {
      const t = setTimeout(() => setSub('team'), TEAM_SPIN_MS);
      return () => clearTimeout(t);
    }
    if (sub === 'team') {
      const t = setTimeout(() => setSub('group'), TEAM_HOLD_MS);
      return () => clearTimeout(t);
    }
    // sub === 'group'
    const t = setTimeout(() => {
      if (step + 1 >= assignments.length) {
        setPhase('done');
      } else {
        setStep((s) => s + 1);
        setSub('spin');
      }
    }, GROUP_HOLD_MS);
    return () => clearTimeout(t);
  }, [phase, sub, step, reduceMotion, assignments.length]);

  // The moment a team is assigned: fill its slot + a themed confetti burst.
  useEffect(() => {
    if (phase !== 'pick' || sub !== 'group') return;
    setRevealed((prev) => {
      if (prev.has(currentIndex)) return prev;
      const next = new Set(prev);
      next.add(currentIndex);
      return next;
    });
    if (!reduceMotion) {
      confetti({
        particleCount: 55,
        spread: 65,
        startVelocity: 32,
        origin: { y: 0.4 },
        colors: [
          currentTeam?.colorPrimary ?? '#3b82f6',
          currentTeam?.colorSecondary ?? '#8b5cf6',
          '#ffffff',
        ],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, sub, step]);

  // Final celebration.
  useEffect(() => {
    if (phase !== 'done' || reduceMotion) return;
    confetti({ particleCount: 140, spread: 90, origin: { x: 0.2, y: 0.6 } });
    confetti({ particleCount: 140, spread: 90, origin: { x: 0.8, y: 0.6 } });
  }, [phase, reduceMotion]);

  const handleSkip = () => {
    setRevealed(new Set(assignments.map((_, i) => i)));
    setPhase('done');
  };

  const isFilled = (index: number) => phase === 'done' || revealed.has(index);

  const stageLabel =
    phase === 'intro'
      ? 'Shuffling teams…'
      : sub === 'spin'
        ? 'Drawing the next team…'
        : sub === 'team'
          ? 'Team drawn!'
          : 'Assigned to group';

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
          <div className="flex items-center gap-3">
            {phase === 'pick' && (
              <span className="hidden sm:inline text-sm font-medium text-slate-400 tabular-nums">
                Team {step + 1} of {assignments.length}
              </span>
            )}
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
        </div>

        {/* Center stage: the team being drawn and its group reveal */}
        <AnimatePresence>
          {phase !== 'done' && (
            <motion.div exit={{ opacity: 0, height: 0 }} className="text-center mb-6 sm:mb-10">
              <div className="text-xs sm:text-sm uppercase tracking-[0.25em] text-slate-400 mb-3 flex items-center justify-center gap-2">
                {sub === 'team' && phase === 'pick' && (
                  <Sparkles className="w-4 h-4 text-yellow-400" />
                )}
                {stageLabel}
              </div>

              <div className="min-h-28 sm:min-h-32 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
                {phase === 'pick' && sub !== 'spin' && currentAssignment ? (
                  <>
                    {/* Drawn team */}
                    <motion.div
                      key={`team-${step}`}
                      initial={{ scale: 0.5, opacity: 0, y: 10 }}
                      animate={{ scale: 1, opacity: 1, y: 0 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                      className="inline-flex items-center gap-3 sm:gap-4 px-5 sm:px-8 py-3 sm:py-4 rounded-2xl shadow-2xl"
                      style={{
                        background: `linear-gradient(135deg, ${currentTeam?.colorPrimary ?? '#2563eb'}, ${currentTeam?.colorSecondary ?? '#7c3aed'})`,
                      }}
                    >
                      <TeamLogo
                        name={teamName(currentAssignment.teamId)}
                        logoUrl={currentTeam?.logoUrl}
                        primaryColor={currentTeam?.colorPrimary}
                        size="md"
                        rounded="full"
                      />
                      <span className="text-xl sm:text-4xl font-bold text-white drop-shadow">
                        {teamName(currentAssignment.teamId)}
                      </span>
                    </motion.div>

                    {/* Group reveal */}
                    {sub === 'group' && (
                      <>
                        <motion.div
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.05 }}
                        >
                          <ArrowRight className="w-6 h-6 sm:w-8 sm:h-8 text-slate-400" />
                        </motion.div>
                        <motion.div
                          key={`group-${step}`}
                          initial={{ scale: 0.3, opacity: 0, rotate: -12 }}
                          animate={{ scale: 1, opacity: 1, rotate: 0 }}
                          transition={{ type: 'spring', stiffness: 260, damping: 14 }}
                          className="inline-flex items-center gap-2 sm:gap-3 px-5 sm:px-7 py-3 sm:py-4 rounded-2xl shadow-2xl"
                          style={{
                            background: `color-mix(in srgb, ${groupAccent(currentAssignment.group)} 22%, #0f172a)`,
                            border: `1px solid ${groupAccent(currentAssignment.group)}`,
                          }}
                        >
                          <span
                            className="flex items-center justify-center w-9 h-9 sm:w-11 sm:h-11 rounded-full text-lg sm:text-2xl font-black text-slate-950"
                            style={{ backgroundColor: groupAccent(currentAssignment.group) }}
                          >
                            {currentAssignment.group}
                          </span>
                          <div className="text-left">
                            <div className="text-[10px] sm:text-xs uppercase tracking-wider text-slate-300">
                              Group
                            </div>
                            <div className="text-lg sm:text-2xl font-bold text-white leading-none">
                              {currentAssignment.slotLabel}
                            </div>
                          </div>
                        </motion.div>
                      </>
                    )}
                  </>
                ) : (
                  // Drumroll spinner
                  <motion.div
                    animate={reduceMotion ? undefined : { scale: [1, 1.03, 1] }}
                    transition={{ duration: 0.4, repeat: Infinity }}
                    className="inline-flex items-center px-6 sm:px-8 py-3 sm:py-4 bg-slate-800/70 border border-slate-600 rounded-2xl"
                  >
                    <span className="text-xl sm:text-4xl font-bold text-slate-300">
                      {cycleNames[cycleIdx % Math.max(cycleNames.length, 1)] ?? '…'}
                    </span>
                  </motion.div>
                )}
              </div>

              {/* Progress dots */}
              {phase === 'pick' && (
                <div className="mt-5 flex items-center justify-center gap-1.5 flex-wrap max-w-md mx-auto">
                  {assignments.map((_, i) => (
                    <span
                      key={i}
                      className={cn(
                        'h-1.5 rounded-full transition-all duration-300',
                        i < step ? 'w-1.5 bg-blue-500' : i === step ? 'w-5 bg-white' : 'w-1.5 bg-slate-700',
                      )}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Group grid filling in as teams are drawn */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {groups.map(([group, slots]) => {
            const accent = groupAccent(group);
            const isActiveGroup = activeGroup === group;
            return (
              <motion.div
                key={group}
                animate={
                  isActiveGroup && !reduceMotion
                    ? { scale: [1, 1.02, 1], boxShadow: `0 0 0 2px ${accent}` }
                    : { scale: 1, boxShadow: '0 0 0 0px rgba(0,0,0,0)' }
                }
                transition={{ duration: 0.5 }}
                className="bg-slate-900/70 border border-slate-700 rounded-xl overflow-hidden"
              >
                <div
                  className="flex items-center gap-2.5 px-4 py-2.5 border-b border-slate-700"
                  style={{ background: `color-mix(in srgb, ${accent} 14%, #1e293b)` }}
                >
                  <span
                    className="flex items-center justify-center w-6 h-6 rounded-md text-xs font-black text-slate-950"
                    style={{ backgroundColor: accent }}
                  >
                    {group}
                  </span>
                  <h3 className="font-bold text-white">Group {group}</h3>
                  <span className="ml-auto text-xs text-slate-400 tabular-nums">
                    {slots.filter(({ index }) => isFilled(index)).length}/{slots.length}
                  </span>
                </div>
                <ul className="divide-y divide-slate-800">
                  {slots.map(({ assignment, index }) => {
                    const team = teamsById.get(assignment.teamId);
                    const filled = isFilled(index);
                    const justFilled = phase === 'pick' && sub === 'group' && index === currentIndex;
                    return (
                      <li
                        key={assignment.slotLabel}
                        className={cn(
                          'flex items-center gap-3 px-4 py-2.5 min-h-[52px] transition-colors',
                          justFilled && 'bg-white/5',
                        )}
                      >
                        <span
                          className={cn(
                            'w-10 shrink-0 text-center text-xs font-bold rounded-md py-1',
                            !filled && 'text-slate-500 border border-dashed border-slate-600',
                          )}
                          style={
                            filled
                              ? {
                                  color: accent,
                                  backgroundColor: `color-mix(in srgb, ${accent} 14%, transparent)`,
                                  border: `1px solid color-mix(in srgb, ${accent} 35%, transparent)`,
                                }
                              : undefined
                          }
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
                          <span className="text-sm text-slate-600">Awaiting draw</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </motion.div>
            );
          })}
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
