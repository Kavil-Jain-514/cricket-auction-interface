/**
 * Pure group-draw logic: validation, group sizing, and random assignment of
 * teams to group slots. Kept free of UI and Convex imports so it can be unit
 * tested and shared by both the client (previews) and server (the draw itself).
 */

/** Random source returning a float in [0, 1). Injectable for deterministic tests. */
export type Rng = () => number;

export interface GroupAssignment<TeamId = string> {
  teamId: TeamId;
  group: string; // "A", "B", ...
  slot: number; // 1-based position within the group
  slotLabel: string; // "A1", "B3", ...
}

/** Alphabetical group name: 0 → "A", 25 → "Z", 26 → "AA", ... */
export function groupName(index: number): string {
  let name = "";
  let i = index;
  do {
    name = String.fromCharCode(65 + (i % 26)) + name;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return name;
}

/**
 * Validate a group configuration. Returns a user-facing error message, or
 * null when the configuration is valid.
 */
export function validateGroupConfig(
  teamCount: number,
  numGroups: number,
): string | null {
  if (teamCount < 1) {
    return "Add teams to the tournament before running a group draw";
  }
  if (!Number.isInteger(numGroups)) {
    return "Number of groups must be a whole number";
  }
  if (numGroups < 1) {
    return "There must be at least 1 group";
  }
  if (numGroups > teamCount) {
    return `Number of groups (${numGroups}) cannot exceed the number of teams (${teamCount})`;
  }
  return null;
}

/**
 * Distribute teams across groups as evenly as possible. When the count is not
 * divisible, earlier groups receive the extra teams (10 teams, 3 groups →
 * [4, 3, 3]).
 */
export function getGroupSizes(teamCount: number, numGroups: number): number[] {
  const base = Math.floor(teamCount / numGroups);
  const remainder = teamCount % numGroups;
  return Array.from({ length: numGroups }, (_, i) =>
    i < remainder ? base + 1 : base,
  );
}

/**
 * Unbiased Fisher–Yates shuffle. Returns a new array; the input is not
 * mutated.
 */
export function fisherYatesShuffle<T>(
  items: readonly T[],
  rng: Rng = Math.random,
): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Compute the full random allotment of teams to group slots. The entire
 * result is decided here, up front — any reveal animation is purely a
 * presentation of this already-final assignment.
 *
 * Throws when the configuration is invalid (see validateGroupConfig).
 */
export function computeGroupAssignments<TeamId>(
  teamIds: readonly TeamId[],
  numGroups: number,
  rng: Rng = Math.random,
): GroupAssignment<TeamId>[] {
  const error = validateGroupConfig(teamIds.length, numGroups);
  if (error) throw new Error(error);

  const shuffled = fisherYatesShuffle(teamIds, rng);
  const sizes = getGroupSizes(teamIds.length, numGroups);

  const assignments: GroupAssignment<TeamId>[] = [];
  let cursor = 0;
  sizes.forEach((size, groupIndex) => {
    const group = groupName(groupIndex);
    for (let slot = 1; slot <= size; slot++) {
      assignments.push({
        teamId: shuffled[cursor++],
        group,
        slot,
        slotLabel: `${group}${slot}`,
      });
    }
  });
  return assignments;
}
