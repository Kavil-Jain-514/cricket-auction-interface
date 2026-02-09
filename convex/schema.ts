import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Users table
  users: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  // Tournaments table
  tournaments: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    createdBy: v.id("users"),
    status: v.union(
      v.literal("draft"),
      v.literal("setup"),
      v.literal("active"),
      v.literal("completed"),
    ),
    settings: v.object({
      basePurse: v.number(), // Base purse per team
      minBidIncrement: v.number(),
      bidTimerSeconds: v.optional(v.number()),
      maxPlayersPerTeam: v.number(),
    }),
    logoUrl: v.optional(v.string()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_creator", ["createdBy"])
    .index("by_status", ["status"]),

  // Teams table
  teams: defineTable({
    tournamentId: v.id("tournaments"),
    name: v.string(),
    logoUrl: v.optional(v.string()),
    ownerName: v.string(),
    sponsorName: v.optional(v.string()),
    // Captain details
    captainName: v.optional(v.string()),
    captainPhotoUrl: v.optional(v.string()),
    captainAge: v.optional(v.number()),
    captainRole: v.optional(
      v.union(
        v.literal("Batter"),
        v.literal("Bowler"),
        v.literal("All-Rounder"),
      ),
    ),
    captainHand: v.optional(v.union(v.literal("Right"), v.literal("Left"))),
    purseRemaining: v.number(),
    purseSpent: v.number(),
    colorPrimary: v.string(), // Hex color for UI
    colorSecondary: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_tournament", ["tournamentId"]),

  // Players table
  players: defineTable({
    tournamentId: v.id("tournaments"),
    name: v.string(),
    phoneNumber: v.optional(v.string()),
    age: v.number(),
    photoUrl: v.optional(v.string()),
    role: v.union(
      v.literal("Batter"),
      v.literal("Bowler"),
      v.literal("All-Rounder"),
      v.literal("All Rounder"),
    ),
    battingBowlingHand: v.union(
      v.literal("Right-handed"),
      v.literal("Left-handed"),
      v.literal("Right"),
      v.literal("Left"),
    ),
    tshirtSize: v.optional(
      v.union(
        v.literal("S"),
        v.literal("M"),
        v.literal("L"),
        v.literal("XL"),
        v.literal("XXL"),
        v.literal("3XL"),
        v.literal("4XL"),
      ),
    ),
    jerseyNumber: v.optional(v.number()),
    availability: v.object({
      type: v.union(v.literal("available"), v.literal("unavailable")),
      dates: v.optional(v.array(v.string())), // ["2025-03-05", "2025-03-06"]
    }),
    basePrice: v.number(), // Starting bid price
    soldPrice: v.optional(v.number()),
    teamId: v.optional(v.id("teams")), // null if unsold
    auctionStatus: v.union(
      v.literal("pending"),
      v.literal("in_auction"),
      v.literal("sold"),
      v.literal("unsold"),
    ),
    stats: v.optional(
      v.object({
        matches: v.optional(v.number()),
        runs: v.optional(v.number()),
        wickets: v.optional(v.number()),
        average: v.optional(v.number()),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tournament", ["tournamentId"])
    .index("by_team", ["teamId"])
    .index("by_status", ["auctionStatus"])
    // Compound index: Find players by tournament + status (for startNextPlayer)
    .index("by_tournament_status", ["tournamentId", "auctionStatus"]),

  // Auction Rooms (Live Auction Sessions)
  // ONLY updated on: start, pause, resume, player change, complete
  // NOT updated on every bid (bids go to liveBids table)
  auctionRooms: defineTable({
    tournamentId: v.id("tournaments"),
    name: v.string(),
    status: v.union(
      v.literal("waiting"),
      v.literal("live"),
      v.literal("paused"),
      v.literal("completed"),
    ),
    currentPlayerId: v.optional(v.id("players")),
    // Legacy fields - kept for backwards compatibility with existing data
    // New bids are stored in liveBids table, these are only for old records
    currentBidAmount: v.optional(v.number()),
    currentBidTeamId: v.optional(v.id("teams")),
    // Timer info - set when player starts, not on each bid
    bidTimerEndsAt: v.optional(v.number()),
    pausedTimeRemaining: v.optional(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tournament", ["tournamentId"])
    // Find active auction rooms quickly
    .index("by_status", ["status"]),

  // ═══════════════════════════════════════════════════════════════════════════
  // LIVE BIDS - Append-only table for real-time bidding
  // This removes hot writes from auctionRooms during bidding
  // ═══════════════════════════════════════════════════════════════════════════
  liveBids: defineTable({
    auctionRoomId: v.id("auctionRooms"),
    playerId: v.id("players"),
    teamId: v.id("teams"),
    amount: v.number(),
    timestamp: v.number(),
  })
    // Get latest bid for a player (used in queries and finalization)
    .index("by_player", ["playerId", "timestamp"])
    // Stream all bids for an auction room in real-time
    .index("by_room", ["auctionRoomId", "timestamp"]),

  // Bids table (Permanent bid history - written only at finalization)
  bids: defineTable({
    auctionRoomId: v.id("auctionRooms"),
    playerId: v.id("players"),
    teamId: v.id("teams"),
    amount: v.number(),
    timestamp: v.number(),
    isFinal: v.boolean(), // True if this was the winning bid
  })
    .index("by_auction_room", ["auctionRoomId"])
    .index("by_player", ["playerId"])
    .index("by_team", ["teamId"]),

  // Auction Events (For live feed/notifications)
  auctionEvents: defineTable({
    auctionRoomId: v.id("auctionRooms"),
    type: v.union(
      v.literal("bid_placed"),
      v.literal("player_sold"),
      v.literal("player_unsold"),
      v.literal("auction_started"),
      v.literal("auction_paused"),
      v.literal("auction_resumed"),
      v.literal("player_started"),
    ),
    data: v.any(), // Flexible data structure for different event types
    timestamp: v.number(),
  })
    .index("by_auction_room", ["auctionRoomId"])
    // Stream events for a room in real-time
    .index("by_room_timestamp", ["auctionRoomId", "timestamp"]),
});
