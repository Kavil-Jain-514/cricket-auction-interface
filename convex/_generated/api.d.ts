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
import type * as bidRules from "../bidRules.js";
import type * as groupDraws from "../groupDraws.js";
import type * as notifications from "../notifications.js";
import type * as players from "../players.js";
import type * as projections from "../projections.js";
import type * as teams from "../teams.js";
import type * as tournaments from "../tournaments.js";

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
  bidRules: typeof bidRules;
  groupDraws: typeof groupDraws;
  notifications: typeof notifications;
  players: typeof players;
  projections: typeof projections;
  teams: typeof teams;
  tournaments: typeof tournaments;
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
