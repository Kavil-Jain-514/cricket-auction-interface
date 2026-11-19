// convex/registrationForms.ts - Saving and reading a tournament's own
// registration questions. Every save is a new version; answered questions
// can be archived but never deleted or retyped, so old answers keep their
// meaning (definition and rules in registrationForm.ts).
import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getTournamentRole, logAdminAction, OWNER_ONLY, REVIEW_REGISTRATIONS, requireTournamentRole } from "./auth";
import {
  normalizeQuestions,
  questionValidator,
  requiredFieldsValidator,
  resolveRequiredFields,
  validateFormQuestions,
  type Question,
} from "./registrationForm";

/**
 * Off switch for a live event: REGISTRATION_CUSTOM_QUESTIONS=off in the
 * Convex environment hides every custom question and stops requiring them.
 */
export function customQuestionsEnabled(): boolean {
  return process.env.REGISTRATION_CUSTOM_QUESTIONS !== "off";
}

export async function latestFormVersion(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
): Promise<Doc<"registrationFormVersions"> | null> {
  return await ctx.db
    .query("registrationFormVersions")
    .withIndex("by_tournament_version", (q) => q.eq("tournamentId", tournamentId))
    .order("desc")
    .first();
}

/** How many registrations answered each question. */
async function answerCounts(ctx: QueryCtx, tournamentId: Id<"tournaments">): Promise<Record<string, number>> {
  const rows = await ctx.db
    .query("registrations")
    .withIndex("by_tournament", (q) => q.eq("tournamentId", tournamentId))
    .collect();
  const counts: Record<string, number> = {};
  for (const r of rows) {
    for (const a of r.answers?.values ?? []) counts[a.questionId] = (counts[a.questionId] ?? 0) + 1;
  }
  return counts;
}

/** Every question ever asked by id; the latest version's wording wins. */
async function questionLabels(ctx: QueryCtx, tournamentId: Id<"tournaments">) {
  const versions = await ctx.db
    .query("registrationFormVersions")
    .withIndex("by_tournament_version", (q) => q.eq("tournamentId", tournamentId))
    .collect();
  const labels: Record<string, Pick<Question, "label" | "type"> & { archived: boolean }> = {};
  for (const version of versions) {
    for (const q of version.questions) labels[q.id] = { label: q.label, type: q.type, archived: q.archived === true };
  }
  // Asked once, then dropped before anyone answered: no longer in the latest.
  const latest = versions.at(-1);
  for (const id of Object.keys(labels)) {
    if (!latest?.questions.some((q) => q.id === id)) labels[id].archived = true;
  }
  return { labels, latest };
}

/**
 * A player's answers from the registration they were approved from, with each
 * question's wording. The tournament's owner (or the super-admin) only; null
 * for anyone else, since the player modal is shown to every viewer.
 */
export const answersForPlayer = query({
  args: { playerId: v.id("players") },
  handler: async (ctx, args) => {
    const player = await ctx.db.get(args.playerId);
    if (!player) return null;
    const access = await getTournamentRole(ctx, player.tournamentId);
    if (access !== "owner" && access !== "super_admin") return null;
    const registration = await ctx.db
      .query("registrations")
      .withIndex("by_player", (q) => q.eq("playerId", args.playerId))
      .first();
    if (!registration?.answers) return [];
    const { labels } = await questionLabels(ctx, player.tournamentId);
    return registration.answers.values.map((a) => ({
      questionId: a.questionId,
      label: labels[a.questionId]?.label ?? "Removed question",
      type: labels[a.questionId]?.type ?? "short_text",
      archived: labels[a.questionId]?.archived ?? true,
      value: a.value,
    }));
  },
});

/**
 * The builder's view: the live questions (archived included), the version to
 * send back on save, answer counts (for the delete warning), and every
 * question ever asked by id (latest label wins) for showing old answers.
 */
export const get = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await requireTournamentRole(ctx, args.tournamentId, REVIEW_REGISTRATIONS);
    const { labels, latest } = await questionLabels(ctx, args.tournamentId);
    return {
      version: latest?.version ?? 0,
      questions: latest?.questions ?? [],
      requiredFields: resolveRequiredFields(latest?.requiredFields),
      answerCounts: await answerCounts(ctx, args.tournamentId),
      labels,
    };
  },
});

/**
 * Save the questions and which standard details are required as a new
 * version. Owners only. Without `requiredFields` the previous rules are kept. `expectedVersion` is the
 * version the editor loaded; if someone saved since, nothing is overwritten.
 */
export const save = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    questions: v.array(questionValidator),
    requiredFields: v.optional(requiredFieldsValidator),
    expectedVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) throw new ConvexError("Tournament not found");
    const owner = await requireTournamentRole(ctx, args.tournamentId, OWNER_ONLY);

    const questions = normalizeQuestions(args.questions);
    const error = validateFormQuestions(questions);
    if (error) throw new ConvexError(error);

    const latest = await latestFormVersion(ctx, args.tournamentId);
    const current = latest?.version ?? 0;
    if (args.expectedVersion !== current) {
      throw new ConvexError("Someone else changed the form since you opened it. Reload to see their changes.");
    }
    const previousRules = resolveRequiredFields(latest?.requiredFields);
    const requiredFields = args.requiredFields ? resolveRequiredFields(args.requiredFields) : previousRules;
    // Stored objects can come back with keys reordered: compare normalised.
    if (
      latest &&
      JSON.stringify(normalizeQuestions(latest.questions)) === JSON.stringify(questions) &&
      JSON.stringify(previousRules) === JSON.stringify(requiredFields)
    ) {
      return { version: current };
    }

    const counts = await answerCounts(ctx, args.tournamentId);
    for (const previous of latest?.questions ?? []) {
      if (!counts[previous.id]) continue;
      const next = questions.find((q) => q.id === previous.id);
      if (!next) throw new ConvexError(`"${previous.label}" has answers; archive it instead of deleting it`);
      if (next.type !== previous.type) throw new ConvexError(`"${previous.label}" has answers; its type can't change`);
    }

    const version = current + 1;
    await ctx.db.insert("registrationFormVersions", {
      tournamentId: args.tournamentId,
      version,
      questions,
      requiredFields,
      createdBy: owner._id,
      createdAt: Date.now(),
    });
    await logAdminAction(ctx, {
      userId: owner._id,
      userEmail: owner.email,
      action: "save_registration_form",
      targetType: "tournament",
      targetId: args.tournamentId,
      previousData: { version: current, requiredFields: previousRules },
      newData: { version, questions: questions.length, requiredFields },
      tournamentId: args.tournamentId,
    });
    return { version };
  },
});
