import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  categoryValidator,
  incrementSlabValidator,
  planTierValidator,
  planValidator,
  presentationOrderValidator,
  sponsorValidator,
  squadRuleValidator,
} from "./ruleValidators";
import { answersValidator, questionValidator } from "./registrationForm";

export default defineSchema({
  // Users table with roles
  users: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    role: v.optional(v.union(v.literal("admin"), v.literal("user"))), // Default: user
    // Asked once after sign-up (convex/policy.ts). "organiser" can create
    // tournaments; "team_owner" can request a team in one (teamRequests).
    accountType: v.optional(
      v.union(v.literal("organiser"), v.literal("team_owner"), v.literal("visitor")),
    ),
    // When accountType was chosen. Absent = choose again: choices made before
    // organisers existed don't count (intentOf).
    accountTypeChosenAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_email", ["email"]),

  // Audit Log for tracking admin actions
  auditLogs: defineTable({
    userId: v.id("users"),
    userEmail: v.string(),
    action: v.string(), // e.g., "reassign_player", "update_sold_price", "adjust_purse"
    targetType: v.string(), // e.g., "player", "team", "auction"
    targetId: v.string(), // ID of the affected entity
    previousData: v.optional(v.any()), // State before change
    newData: v.optional(v.any()), // State after change
    tournamentId: v.optional(v.id("tournaments")),
    auctionRoomId: v.optional(v.id("auctionRooms")),
    timestamp: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_tournament", ["tournamentId"])
    .index("by_timestamp", ["timestamp"]),

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
      basePrice: v.optional(v.number()), // Default base price for players, if not provided it's 1,00,000 for legacy reasons
      footerText: v.optional(v.string()), // Shown under the brand on the viewer page; absent = hidden
      // Who may bid. Absent = "admin_only" (legacy behaviour). "confirm": owner
      // raises queue as bidRequests for the auctioneer to accept. "open": valid
      // owner raises go straight to liveBids. Not locked during a live auction.
      bidMode: v.optional(
        v.union(
          v.literal("admin_only"),
          v.literal("confirm"),
          v.literal("open"),
        ),
      ),
      // Player categories (e.g. Marquee, A, B, Uncapped). A player's base price
      // falls back to its category's, then to `basePrice` above. Absent = none.
      categories: v.optional(v.array(categoryValidator)),
      // Price-band increments, ascending by fromAmount (e.g. 0:25k, 5L:50k).
      // Absent or empty = `minBidIncrement` for every bid (legacy behaviour).
      incrementSlabs: v.optional(v.array(incrementSlabValidator)),
      // Main-round order. Absent = "random" (legacy). "by_category": lowest
      // category order first, random within a category, uncategorised last.
      presentationOrder: presentationOrderValidator,
      // Squad composition, per category or role (e.g. max 2 Marquee, min 1
      // Wicket Keeper). Enforced in applyBid; see squadRules.ts.
      squadRules: v.optional(v.array(squadRuleValidator)),
      // Public self-registration (/register/<id>). Not locked while live.
      registrationOpen: v.optional(v.boolean()),
      registrationFee: v.optional(v.number()), // rupees; absent or 0 = free
      // UPI QR the registrant scans to pay the fee; they upload a screenshot.
      paymentQrUrl: v.optional(v.string()),
    }),
    logoUrl: v.optional(v.string()),
    // Shown on the public registration form. Not a locked setting.
    sponsors: v.optional(v.array(sponsorValidator)),
    // Paid tier and its limits (convex/plans.ts). Set to Free on create;
    // absent on tournaments from before plans, which stay unlimited.
    plan: v.optional(planValidator),
    // Visibility flag (independent of the auction lifecycle `status` above).
    // When false, non-admin users can neither see the tournament in listings
    // nor open it. Absent on legacy tournaments — treated as active.
    isActive: v.optional(v.boolean()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    // Denormalized player-status counts, maintained on the write side by
    // syncTournamentAuctionCounts (convex/auctionCounts.ts) so the hot
    // getAuctionRoster fan-out doesn't have to scan the players table.
    // Optional: absent on legacy tournaments until the backfill runs; the
    // roster query falls back to a live scan when this is undefined.
    auctionCounts: v.optional(
      v.object({
        pending: v.number(),
        sold: v.number(),
        unsold: v.number(),
        inAuction: v.number(),
        minPendingBasePrice: v.optional(v.number()), // undefined when no pending players
        // Cheapest pending base price per squad min rule (reserve for unmet minimums).
        minPendingBasePriceByRule: v.optional(
          v.array(v.object({ ruleId: v.string(), price: v.number() })),
        ),
      }),
    ),
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
    // When the captain is chosen from the tournament's players, this links to
    // that player and the display fields below are denormalized from them.
    captainPlayerId: v.optional(v.id("players")),
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
    // Signed total of admin purse adjustments (penalties, top-ups), each logged
    // with a reason. Absent = 0. purseRemaining + purseSpent always equals
    // settings.basePurse + purseAdjustment (see teamPurseTotal in bidRules.ts).
    purseAdjustment: v.optional(v.number()),
    colorPrimary: v.string(), // Hex color for UI
    colorSecondary: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_tournament", ["tournamentId"]),

  // Organiser access per tournament. The creator is its "owner"; owners can
  // add "auctioneer"s, who run the auction on the day. users.role "admin" is
  // the platform super-admin and passes every check (requireTournamentRole).
  tournamentStaff: defineTable({
    tournamentId: v.id("tournaments"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("auctioneer")),
    createdAt: v.number(),
  })
    .index("by_tournament", ["tournamentId"])
    .index("by_user", ["userId"])
    .index("by_tournament_user", ["tournamentId", "userId"]),

  // Console action results by client requestId (convex/idempotency.ts), so a
  // retried placeBid / acceptBidRequest / finalizePlayerSale applies once.
  bidRequestsSeen: defineTable({
    key: v.string(), // "<kind>:<requestId>"
    auctionRoomId: v.id("auctionRooms"),
    result: v.any(),
    createdAt: v.number(),
  })
    .index("by_room_key", ["auctionRoomId", "key"])
    .index("by_createdAt", ["createdAt"]),

  // Point-in-time copies of a tournament's auction state, taken automatically
  // before auction start and before every destructive action
  // (convex/snapshots.ts). Rows live in snapshotChunks so a large roster never
  // hits the 1 MiB document limit. Kept after the tournament is deleted.
  tournamentSnapshots: defineTable({
    tournamentId: v.id("tournaments"),
    tournamentName: v.string(),
    reason: v.string(), // e.g. "before restart_auction"
    createdBy: v.optional(v.id("users")),
    counts: v.object({
      players: v.number(),
      teams: v.number(),
      bids: v.number(),
      events: v.number(),
    }),
    createdAt: v.number(),
  }).index("by_tournament", ["tournamentId", "createdAt"]),

  snapshotChunks: defineTable({
    snapshotId: v.id("tournamentSnapshots"),
    table: v.string(),
    index: v.number(),
    rows: v.array(v.any()),
  }).index("by_snapshot", ["snapshotId", "table", "index"]),

  // Self-registrations from the public form. "paid" means ready for review
  // (fee paid, or no fee); approval creates the player.
  registrations: defineTable({
    tournamentId: v.id("tournaments"),
    name: v.string(),
    age: v.number(),
    role: v.array(v.string()),
    battingBowlingHand: v.union(v.literal("Right-handed"), v.literal("Left-handed")),
    phoneNumber: v.string(), // normalised 10 digits
    photoUrl: v.optional(v.string()),
    jerseyNumber: v.optional(v.number()),
    jerseyName: v.optional(v.string()),
    tshirtSize: v.optional(
      v.union(v.literal("XS"), v.literal("S"), v.literal("M"), v.literal("L"), v.literal("XL"), v.literal("XXL"), v.literal("3XL"), v.literal("4XL")),
    ),
    // Self-selected settings.categories[].id; the owner can change it.
    categoryId: v.optional(v.string()),
    consentWhatsApp: v.boolean(),
    status: v.union(v.literal("pending_payment"), v.literal("paid"), v.literal("approved"), v.literal("rejected")),
    fee: v.number(), // rupees at submission
    razorpayOrderId: v.optional(v.string()),
    paymentRef: v.optional(v.string()),
    // How the fee was paid. "qr": the registrant uploaded a screenshot
    // (paymentProofUrl) for the owner to check. "offline": in person; stays
    // pending_payment until the owner marks it paid.
    paymentMethod: v.optional(v.union(v.literal("razorpay"), v.literal("qr"), v.literal("offline"))),
    paymentProofUrl: v.optional(v.string()),
    rejectReason: v.optional(v.string()),
    playerId: v.optional(v.id("players")),
    // Answers to the organiser's own questions, with the form version they
    // were given against (registrationFormVersions). Absent = none asked.
    answers: v.optional(answersValidator),
    createdAt: v.number(),
    reviewedAt: v.optional(v.number()),
  })
    .index("by_tournament", ["tournamentId"])
    .index("by_tournament_phone", ["tournamentId", "phoneNumber"])
    .index("by_order", ["razorpayOrderId"]),

  // The organiser's own registration questions (convex/registrationForm.ts),
  // one row per saved version so answers always resolve to the question they
  // answered. The latest version is the live form; none = core fields only.
  registrationFormVersions: defineTable({
    tournamentId: v.id("tournaments"),
    version: v.number(), // 1, 2, …
    questions: v.array(questionValidator),
    createdBy: v.id("users"),
    createdAt: v.number(),
  }).index("by_tournament_version", ["tournamentId", "version"]),

  // Teams requested by self-declared team owners (users.accountType
  // "team_owner"). The tournament's owner approves, which creates the team
  // and makes the requester its owner member.
  teamRequests: defineTable({
    tournamentId: v.id("tournaments"),
    userId: v.id("users"),
    name: v.string(),
    ownerName: v.string(),
    sponsorName: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    colorPrimary: v.string(),
    colorSecondary: v.string(),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    rejectReason: v.optional(v.string()),
    teamId: v.optional(v.id("teams")),
    createdAt: v.number(),
    reviewedAt: v.optional(v.number()),
  })
    .index("by_tournament", ["tournamentId"])
    .index("by_user", ["userId"]),

  // Razorpay orders for plan upgrades. Recorded when the order is created;
  // the signed webhook marks it paid and upgrades the plan (idempotent on
  // paymentRef). No card data is ever stored.
  paymentOrders: defineTable({
    tournamentId: v.id("tournaments"),
    tier: planTierValidator,
    amount: v.number(), // paise
    razorpayOrderId: v.string(),
    status: v.union(v.literal("created"), v.literal("paid")),
    paymentRef: v.optional(v.string()),
    // Paid, but no longer an upgrade when it arrived (a higher order was paid
    // first), so the plan was left alone and the money must be refunded.
    refundDue: v.optional(v.boolean()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    paidAt: v.optional(v.number()),
  })
    .index("by_order", ["razorpayOrderId"])
    .index("by_tournament", ["tournamentId"]),

  // WhatsApp outbox (convex/notifications.ts). One row per event and person
  // (dedupeKey), so a restart, a re-sale to the same team, a retry or a
  // double click never messages twice. A worker sends, retries with backoff
  // up to MAX_ATTEMPTS, and never touches the sale or registration itself.
  notifications: defineTable({
    kind: v.union(v.literal("player_sold"), v.literal("registration_received"), v.literal("registration_approved")),
    // "sold:<playerId>:<teamId>", "registered:<registrationId>", "approved:<registrationId>"
    dedupeKey: v.string(),
    tournamentId: v.id("tournaments"),
    playerId: v.optional(v.id("players")), // absent for "registration_received"
    registrationId: v.optional(v.id("registrations")),
    payload: v.union(
      v.object({
        playerName: v.string(),
        phoneNumber: v.string(),
        tournamentName: v.string(),
        teamName: v.string(),
        ownerName: v.string(),
        captainName: v.optional(v.string()),
        soldPrice: v.number(),
      }),
      v.object({ playerName: v.string(), phoneNumber: v.string(), tournamentName: v.string() }),
    ),
    status: v.union(
      v.literal("queued"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("delivered"), // from the delivery webhook
      v.literal("failed"),
      v.literal("skipped"),
    ),
    attempts: v.number(),
    nextAttemptAt: v.number(),
    claimedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    messageId: v.optional(v.string()),
    createdAt: v.number(),
    sentAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
  })
    .index("by_dedupe", ["dedupeKey"])
    .index("by_status_next", ["status", "nextAttemptAt"])
    // Deleting a tournament deletes its outbox rows (they hold phone numbers).
    .index("by_tournament", ["tournamentId"])
    .index("by_messageId", ["messageId"]),

  // Numbers that replied STOP to our WhatsApp messages (E.164 digits). Never
  // messaged again until they reply START.
  whatsappOptOuts: defineTable({
    phone: v.string(),
    at: v.number(),
  }).index("by_phone", ["phone"]),

  // ── Deleting a tournament (convex/fileCleanup.ts) ─────────────────────────
  // Rows go at once. The safety snapshot and paid registrations are kept for
  // the retention period (a mistaken delete can be recovered, refunds
  // settled), then purged here; only registrationOrders (payment reference
  // and amount, no personal data) outlive it.
  tournamentPurges: defineTable({
    tournamentId: v.id("tournaments"), // already deleted
    tournamentName: v.string(),
    purgeAt: v.number(),
    status: v.union(v.literal("scheduled"), v.literal("done")),
    createdBy: v.id("users"),
    createdAt: v.number(),
    doneAt: v.optional(v.number()),
  }).index("by_status_purgeAt", ["status", "purgeAt"]),

  // Stored files to delete from Cloudinary, one row per URL. "waiting" until
  // the tournament's purge (its snapshot still points at them), then
  // "pending" for the hourly worker, which retries with backoff up to
  // MAX_ATTEMPTS ("failed" = dead letter, shown on /admin/live). "in_use":
  // another tournament still shows the file, so it is kept. "skipped": not a
  // file we stored (another host, a legacy URL).
  fileCleanup: defineTable({
    url: v.string(),
    purgeId: v.id("tournamentPurges"),
    status: v.union(
      v.literal("waiting"),
      v.literal("pending"),
      v.literal("deleting"),
      v.literal("done"),
      v.literal("in_use"),
      v.literal("skipped"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    nextAttemptAt: v.number(),
    claimedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    doneAt: v.optional(v.number()),
  })
    .index("by_url", ["url"])
    .index("by_purge", ["purgeId"])
    .index("by_status_next", ["status", "nextAttemptAt"]),

  // ── Live-ops panel (convex/ops.ts) ─────────────────────────────────────────
  // Who has a console or owner paddle open, from a 30 s heartbeat. Viewers
  // never write here (D2: too many writes at 2,500 viewers).
  presence: defineTable({
    userId: v.id("users"),
    auctionRoomId: v.id("auctionRooms"),
    tournamentId: v.id("tournaments"),
    role: v.union(v.literal("console"), v.literal("owner")),
    lastSeen: v.number(),
  })
    .index("by_room", ["auctionRoomId", "lastSeen"])
    .index("by_user_room", ["userId", "auctionRoomId"]),

  // Mutation exceptions seen by consoles and owner paddles (not rule refusals).
  clientErrors: defineTable({
    userId: v.id("users"),
    auctionRoomId: v.id("auctionRooms"),
    fn: v.string(),
    message: v.string(),
    at: v.number(),
  }).index("by_at", ["at"]),

  // Every Razorpay webhook received, with what happened to it.
  webhookEvents: defineTable({
    event: v.string(),
    orderId: v.optional(v.string()),
    outcome: v.string(),
    receivedAt: v.number(),
  }).index("by_receivedAt", ["receivedAt"]),

  // Fixed-window counters for public entry points (convex/rateLimit.ts).
  rateLimits: defineTable({
    key: v.string(), // e.g. "register:<tournamentId>"
    windowStart: v.number(),
    count: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_windowStart", ["windowStart"]),

  // Every Razorpay order opened for a registration fee. A registrant can open
  // checkout more than once; each order is kept so whichever one is paid is
  // found. A payment that can't be applied (already paid, rejected) is kept
  // with refundDue so it is never silently lost.
  registrationOrders: defineTable({
    registrationId: v.id("registrations"),
    tournamentId: v.id("tournaments"),
    razorpayOrderId: v.string(),
    amount: v.number(), // paise
    status: v.union(v.literal("created"), v.literal("paid")),
    paymentRef: v.optional(v.string()),
    refundDue: v.optional(v.boolean()),
    createdAt: v.number(),
    paidAt: v.optional(v.number()),
  })
    .index("by_order", ["razorpayOrderId"])
    .index("by_tournament", ["tournamentId"]),

  // Team members — users linked to a team (owners bid from their own phones).
  // A user belongs to at most one team per tournament (enforced by claimInvite).
  teamMembers: defineTable({
    teamId: v.id("teams"),
    tournamentId: v.id("tournaments"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("viewer")),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_team", ["teamId"]),

  // One-time owner invite links. Only the SHA-256 of the token is stored.
  teamInvites: defineTable({
    teamId: v.id("teams"),
    tournamentId: v.id("tournaments"),
    tokenHash: v.string(),
    expiresAt: v.number(),
    createdBy: v.id("users"),
    usedBy: v.optional(v.id("users")),
    usedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_team", ["teamId"]),

  // Owner raises waiting for the auctioneer (bidMode "confirm"). At most one
  // "pending" request per team and player; a newer raise supersedes the older.
  bidRequests: defineTable({
    auctionRoomId: v.id("auctionRooms"),
    playerId: v.id("players"),
    teamId: v.id("teams"),
    userId: v.id("users"),
    amount: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("rejected"),
      v.literal("superseded"),
    ),
    reason: v.optional(v.string()),
    // Top live bid when the raise was made (null = none). A raise is only
    // valid at that price; any later bid, revert or sale expires it.
    // Absent on requests from before this field (accepted on amount alone).
    basedOnBid: v.optional(v.union(v.number(), v.null())),
    createdAt: v.number(),
  })
    .index("by_room_player_status", ["auctionRoomId", "playerId", "status"])
    .index("by_team", ["teamId"]),

  // Players table
  players: defineTable({
    tournamentId: v.id("tournaments"),
    name: v.string(),
    phoneNumber: v.optional(v.string()),
    age: v.number(),
    photoUrl: v.optional(v.string()),
    // Supports both legacy single string ("Batter") and new array format (["Batter", "Wicket Keeper"])
    role: v.union(v.string(), v.array(v.string())),
    battingBowlingHand: v.union(
      v.literal("Right-handed"),
      v.literal("Left-handed"),
      v.literal("Right"),
      v.literal("Left"),
    ),
    tshirtSize: v.optional(
      v.union(
        v.literal("XS"),
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
    jerseyName: v.optional(v.string()),
    // From the registration form. false = declined WhatsApp messages; absent
    // = added by the organiser (who is responsible for consent).
    consentWhatsApp: v.optional(v.boolean()),
    playerNumber: v.optional(v.number()), // Auto-incremented player number starting from 1
    basePrice: v.optional(v.number()), // Starting bid price, if undefined inherits from the category, then the tournament
    categoryId: v.optional(v.string()), // tournaments.settings.categories[].id
    soldPrice: v.optional(v.number()),
    teamId: v.optional(v.id("teams")), // null if unsold
    auctionStatus: v.union(
      v.literal("pending"),
      v.literal("in_auction"),
      v.literal("sold"),
      v.literal("unsold"),
      // Terminal state: player removed from the auction entirely. Set by an admin
      // during the unsold (second) round. Never re-enters the pending/unsold pool
      // and does not play for any team.
      v.literal("final_unsold"),
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
    .index("by_tournament_status", ["tournamentId", "auctionStatus"])
    // Duplicate check on the public registration form, without a full scan.
    .index("by_tournament_phone", ["tournamentId", "phoneNumber"]),

  // Group Draws - random allotment of teams into groups (one per tournament).
  // Assignments are computed server-side in a single mutation and persisted
  // whole, so every viewer sees the same final result.
  groupDraws: defineTable({
    tournamentId: v.id("tournaments"),
    numGroups: v.number(),
    status: v.union(v.literal("drawn"), v.literal("locked")),
    assignments: v.array(
      v.object({
        teamId: v.id("teams"),
        group: v.string(), // "A", "B", ...
        slot: v.number(), // 1-based position within the group
        slotLabel: v.string(), // "A1", "B3", ...
      }),
    ),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_tournament", ["tournamentId"]),

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
    // Auction round for the viewer progress counter. "main" = first pass over
    // all players; "unsold" = re-auctioning the players who went unsold.
    auctionPhase: v.optional(v.union(v.literal("main"), v.literal("unsold"))),
    // Number of players that were unsold when the current unsold round began —
    // the denominator for the "X / N" counter during the unsold round.
    unsoldRoundTotal: v.optional(v.number()),
    // ── Iterative unsold rounds ───────────────────────────────────────────
    // 1 = main round; 2 = first unsold round; 3 = second unsold round; …
    // Displayed as "Unsold Round {roundNumber - 1}".
    roundNumber: v.optional(v.number()),
    // Ordered snapshot of the players to present in the CURRENT unsold round.
    // Built (reshuffled) when each unsold round begins; each is presented once.
    unsoldQueue: v.optional(v.array(v.id("players"))),
    // Index of the next player to present within unsoldQueue.
    unsoldCursor: v.optional(v.number()),
    // Set when an unsold round completed without selling or final-unselling
    // anyone — the admin must choose how to proceed (infinite-loop guard).
    roundStalled: v.optional(v.boolean()),
    // presentationOrder "by_category": the set (category id) being presented.
    // Changing it is what announces "Now: <category> set" on every client.
    currentSetId: v.optional(v.string()),
    // Copy of !tournament.isActive (set by tournaments:setActive), so the hot
    // query can hide a deactivated tournament without reading another doc.
    tournamentHidden: v.optional(v.boolean()),
    // Rehearsal mode (snapshots:startRehearsal): a practice run that
    // endRehearsal rewinds to rehearsalSnapshotId. No WhatsApp is sent.
    rehearsal: v.optional(v.boolean()),
    rehearsalSnapshotId: v.optional(v.id("tournamentSnapshots")),
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
    // Who placed it. Optional: absent on bids from before owner bidding.
    source: v.optional(v.union(v.literal("admin"), v.literal("owner"))),
    userId: v.optional(v.id("users")),
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
    source: v.optional(v.union(v.literal("admin"), v.literal("owner"))),
    userId: v.optional(v.id("users")),
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
      v.literal("player_restarted"),
    ),
    data: v.any(), // Flexible data structure for different event types
    timestamp: v.number(),
  })
    .index("by_auction_room", ["auctionRoomId"])
    // Stream events for a room in real-time
    .index("by_room_timestamp", ["auctionRoomId", "timestamp"]),
});
