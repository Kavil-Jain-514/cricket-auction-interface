/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as auctionCounts from "../auctionCounts.js";
import type * as auctions from "../auctions.js";
import type * as auth from "../auth.js";
import type * as bidCore from "../bidCore.js";
import type * as bidRules from "../bidRules.js";
import type * as groupDraws from "../groupDraws.js";
import type * as http from "../http.js";
import type * as members from "../members.js";
import type * as notifications from "../notifications.js";
import type * as payments from "../payments.js";
import type * as planTiers from "../planTiers.js";
import type * as plans from "../plans.js";
import type * as players from "../players.js";
import type * as presentation from "../presentation.js";
import type * as projections from "../projections.js";
import type * as razorpaySignature from "../razorpaySignature.js";
import type * as results from "../results.js";
import type * as ruleValidators from "../ruleValidators.js";
import type * as squadRules from "../squadRules.js";
import type * as staff from "../staff.js";
import type * as teams from "../teams.js";
import type * as tournaments from "../tournaments.js";
import type * as validation from "../validation.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  auctionCounts: typeof auctionCounts;
  auctions: typeof auctions;
  auth: typeof auth;
  bidCore: typeof bidCore;
  bidRules: typeof bidRules;
  groupDraws: typeof groupDraws;
  http: typeof http;
  members: typeof members;
  notifications: typeof notifications;
  payments: typeof payments;
  planTiers: typeof planTiers;
  plans: typeof plans;
  players: typeof players;
  presentation: typeof presentation;
  projections: typeof projections;
  razorpaySignature: typeof razorpaySignature;
  results: typeof results;
  ruleValidators: typeof ruleValidators;
  squadRules: typeof squadRules;
  staff: typeof staff;
  teams: typeof teams;
  tournaments: typeof tournaments;
  validation: typeof validation;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
