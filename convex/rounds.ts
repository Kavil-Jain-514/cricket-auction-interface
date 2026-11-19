// convex/rounds.ts - Which player comes up next, as a pure decision
// (AUDIT 2026-11 CQ-001). auctions:startNextPlayer loads the pools, asks
// chooseNext, and applies the answer; every branch of the round logic is
// unit-testable here without a database.
//
// The rounds:
//   main round   random pick from the pending pool; with presentationOrder
//                "by_category", one category ("set") at a time, lowest order
//                first, each new named set announced before its first player.
//   unsold round the players left unsold, in a shuffled queue, each presented
//                once. The first unsold round is announced; later ones start
//                straight away. A round that sold or removed nobody stalls,
//                and the auctioneer decides (resolveStalledRound).
import type { Id } from "./_generated/dataModel";
import type { PlayerCategory } from "./bidRules";
import { nextPresentationSet } from "./presentation";

/** In-place Fisher–Yates shuffle (each unsold round's queue). */
export function shuffleInPlace<T>(arr: T[], random: () => number = Math.random): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Round bookkeeping written on the room alongside currentPlayerId. */
export type RoomRoundPatch = {
  auctionPhase?: "main" | "unsold";
  roundNumber?: number;
  unsoldQueue?: Id<"players">[];
  unsoldCursor?: number;
  unsoldRoundTotal?: number;
  currentSetId?: string;
};

type Candidate = { _id: Id<"players">; categoryId?: string };

export type NextDecision<P extends Candidate> =
  /** Put `player` on the block, with this round bookkeeping. */
  | { kind: "present"; player: P; roomPatch: RoomRoundPatch }
  /** Announce a new category set; nobody is loaded yet. */
  | { kind: "enterSet"; setId: string }
  /** Announce the first unsold round with this queue; nobody is loaded yet. */
  | { kind: "enterUnsoldRound"; queue: Id<"players">[] }
  /** A whole unsold round passed without anyone leaving the pool. */
  | { kind: "stall" }
  /** Nobody left to auction. */
  | { kind: "complete" };

/**
 * The next step of the auction. `pending` and `unsold` are the pools with
 * captains already left out. The room fields are the current round state.
 */
export function chooseNext<P extends Candidate>(input: {
  room: {
    auctionPhase?: "main" | "unsold";
    currentSetId?: string;
    unsoldQueue?: Id<"players">[];
    unsoldCursor?: number;
    roundNumber?: number;
  };
  presentationOrder?: "random" | "by_category";
  categories?: PlayerCategory[];
  pending: P[];
  unsold: P[];
  random?: () => number;
}): NextDecision<P> {
  const random = input.random ?? Math.random;
  const { room } = input;

  // ── Main round ─────────────────────────────────────────────────────────
  if (input.pending.length > 0) {
    let pool = input.pending;
    let setPatch: RoomRoundPatch = {};
    if (input.presentationOrder === "by_category") {
      const set = nextPresentationSet(input.pending, input.categories)!;
      // Entering a new named set is announced before its first player.
      if (set.category && set.setId !== room.currentSetId) {
        return { kind: "enterSet", setId: set.setId };
      }
      pool = set.players;
      setPatch = { currentSetId: set.setId };
    }
    const player = pool[Math.floor(random() * pool.length)];
    return { kind: "present", player, roomPatch: { auctionPhase: "main", roundNumber: 1, ...setPatch } };
  }

  // ── Unsold rounds ──────────────────────────────────────────────────────
  // Everyone is sold or final_unsold: the auction is over.
  if (input.unsold.length === 0) return { kind: "complete" };

  const unsoldById = new Map(input.unsold.map((p) => [p._id, p]));

  // First crossing main -> unsold: announce it with round 2's queue.
  if (room.auctionPhase !== "unsold") {
    return { kind: "enterUnsoldRound", queue: shuffleInPlace(input.unsold.map((p) => p._id), random) };
  }

  // Mid-round: the next queued player still unsold (anyone sold or marked
  // final_unsold since the queue was built is skipped).
  const queue = room.unsoldQueue ?? [];
  let cursor = room.unsoldCursor ?? 0;
  while (cursor < queue.length) {
    const player = unsoldById.get(queue[cursor]);
    cursor++;
    if (player) return { kind: "present", player, roomPatch: { auctionPhase: "unsold", unsoldCursor: cursor } };
  }

  // Round over. It made progress iff someone from THIS round's queue left the
  // unsold pool; compare membership, not counts (a queued player can sell
  // while another becomes unsold through a correction).
  if (queue.length > 0 && queue.every((id) => unsoldById.has(id))) return { kind: "stall" };

  // Progress: the next unsold round, reshuffled, starts immediately.
  const nextQueue = shuffleInPlace(input.unsold.map((p) => p._id), random);
  return {
    kind: "present",
    player: unsoldById.get(nextQueue[0])!,
    roomPatch: {
      auctionPhase: "unsold",
      roundNumber: (room.roundNumber ?? 2) + 1,
      unsoldQueue: nextQueue,
      unsoldCursor: 1,
      unsoldRoundTotal: nextQueue.length,
    },
  };
}

/** True when every team has a full squad (sold players only). */
export function allSquadsFull(
  teamIds: string[],
  soldTeamIds: Array<string | undefined>,
  maxPlayersPerTeam: number,
): boolean {
  if (teamIds.length === 0) return false;
  const counts = new Map<string, number>();
  for (const id of soldTeamIds) if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  return teamIds.every((id) => (counts.get(id) ?? 0) >= maxPlayersPerTeam);
}
