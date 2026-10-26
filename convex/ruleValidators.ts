// convex/ruleValidators.ts
// Argument/schema validators for the auction-rule settings, shared by
// schema.ts and the tournaments mutations so the two can't drift.
import { v } from "convex/values";

export const categoryValidator = v.object({
  id: v.string(),
  name: v.string(),
  basePrice: v.number(),
  order: v.number(),
  colour: v.string(),
});

export const incrementSlabValidator = v.object({
  fromAmount: v.number(),
  increment: v.number(),
});

export const presentationOrderValidator = v.optional(
  v.union(v.literal("random"), v.literal("by_category")),
);

export const squadRuleValidator = v.object({
  id: v.string(),
  categoryId: v.optional(v.string()),
  role: v.optional(v.string()),
  min: v.optional(v.number()),
  max: v.optional(v.number()),
});
