// convex/auctions.ts
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Create a new auction room
export const createAuctionRoom = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    // Find user
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", identity.email!))
      .first();

    if (!user) throw new Error("User not found");

    // Create auction room
    const auctionRoomId = await ctx.db.insert("auctionRooms", {
      tournamentId: args.tournamentId,
      name: args.name,
      status: "waiting",
      createdBy: user._id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return auctionRoomId;
  },
});

// Start the auction (set status to live)
export const startAuction = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (auctionRoom.status === "live") {
      return { success: true, message: "Auction already live" };
    }

    if (auctionRoom.status === "completed") {
      throw new Error("Auction has already completed");
    }

    await ctx.db.patch(args.auctionRoomId, {
      status: "live",
      updatedAt: Date.now(),
    });

    // Create auction started event
    await ctx.db.insert("auctionEvents", {
      auctionRoomId: args.auctionRoomId,
      type: "auction_started",
      data: {},
      timestamp: Date.now(),
    });

    return { success: true };
  },
});

// Pause the auction
export const pauseAuction = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    let remainingTime = 0;
    if (auctionRoom.bidTimerEndsAt) {
      remainingTime = Math.max(
        0,
        Math.ceil((auctionRoom.bidTimerEndsAt - Date.now()) / 1000),
      );
    }

    await ctx.db.patch(args.auctionRoomId, {
      status: "paused",
      updatedAt: Date.now(),
      pausedTimeRemaining: remainingTime,
      bidTimerEndsAt: undefined,
    });

    await ctx.db.insert("auctionEvents", {
      auctionRoomId: args.auctionRoomId,
      type: "auction_paused",
      data: {},
      timestamp: Date.now(),
    });

    return { success: true };
  },
});

// Resume the auction
export const resumeAuction = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (auctionRoom.status !== "paused") {
      throw new Error("Auction is not paused");
    }

    // Get tournament for timer settings
    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    // Prepare updates. We'll set bidTimerEndsAt only when needed below.
    const updates: Partial<typeof auctionRoom> = {
      status: "live",
      updatedAt: Date.now(),
    };

    // Always restart from full timer duration (30 seconds)
    if (auctionRoom.currentPlayerId) {
      updates.bidTimerEndsAt =
        Date.now() + tournament.settings.bidTimerSeconds * 1000;
      updates.pausedTimeRemaining = undefined; // Clear saved time
    }

    await ctx.db.patch(args.auctionRoomId, updates);

    return { success: true };
  },
});

// Place a bid in the auction
export const placeBid = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
    teamId: v.id("teams"),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    // Get current auction state
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (auctionRoom.status !== "live") {
      // Return silently if not live - prevents error spam
      return { success: false, reason: "Auction is not live" };
    }

    if (!auctionRoom.currentPlayerId) {
      return { success: false, reason: "No player currently in auction" };
    }

    // Get player and validate
    const player = await ctx.db.get(auctionRoom.currentPlayerId);
    if (!player) throw new Error("Player not found");

    // Validate team has enough purse
    const team = await ctx.db.get(args.teamId);
    if (!team) throw new Error("Team not found");

    if (team.purseRemaining < args.amount) {
      return { success: false, reason: "Insufficient purse balance" };
    }

    // Validate bid amount
    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    const minBidIncrement = tournament.settings.minBidIncrement;
    // Check if this is the first bid (base price)
    const currentBid = auctionRoom.currentBidAmount || player.basePrice || 0;

    // Allow bids equal to the current bid. Enforce minimum increment only for increases.
    // First bid (when currentBid equals player.basePrice) must be at least base price (equal allowed)
    if (currentBid === 0 || currentBid === player.basePrice) {
      if (args.amount < player.basePrice) {
        return {
          success: false,
          reason: `First bid must be at least base price: ₹${player.basePrice}`,
        };
      }
    } else {
      // If bid is less than current bid -> reject
      if (args.amount < currentBid) {
        return {
          success: false,
          reason: `Bid must be at least the current bid ₹${currentBid}`,
        };
      }

      // If bid is an increase (strictly greater), it must respect the min increment
      if (
        args.amount > currentBid &&
        args.amount < currentBid + minBidIncrement
      ) {
        return {
          success: false,
          reason: `Minimum increase is ₹${minBidIncrement} (next valid: ₹${currentBid + minBidIncrement})`,
        };
      }
    }
    const now = Date.now();
    const timerDuration = tournament.settings.bidTimerSeconds * 1000;

    await Promise.all([
      // Update auction room
      ctx.db.patch(args.auctionRoomId, {
        currentBidAmount: args.amount,
        currentBidTeamId: args.teamId,
        bidTimerEndsAt: now + timerDuration,
        updatedAt: now,
      }),

      // Record bid
      ctx.db.insert("bids", {
        auctionRoomId: args.auctionRoomId,
        playerId: auctionRoom.currentPlayerId,
        teamId: args.teamId,
        amount: args.amount,
        timestamp: now,
        isFinal: false,
      }),

      // Create event
      ctx.db.insert("auctionEvents", {
        auctionRoomId: args.auctionRoomId,
        type: "bid_placed",
        data: {
          teamId: args.teamId,
          playerId: auctionRoom.currentPlayerId,
          amount: args.amount,
        },
        timestamp: now,
      }),
    ]);

    return { success: true };
  },
});

// Finalize player sale
export const finalizePlayerSale = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    // Allow finalize only when auction is live
    if (auctionRoom.status !== "live") {
      return { success: false, reason: "Auction is not live" };
    }

    const { currentPlayerId, currentBidTeamId, currentBidAmount } = auctionRoom;

    if (!currentPlayerId) {
      return { success: false, reason: "No player in auction" };
    }

    const player = await ctx.db.get(currentPlayerId);
    if (!player) throw new Error("Player not found");

    const result = {
      playerName: player.name,
      teamName: null as string | null,
      amount: currentBidAmount || 0,
      sold: false,
    };

    // Player sold
    if (currentBidTeamId && currentBidAmount) {
      const team = await ctx.db.get(currentBidTeamId);
      result.teamName = team?.name || null;
      result.sold = true;
      // Update player
      await Promise.all([
        ctx.db.patch(currentPlayerId, {
          teamId: currentBidTeamId,
          soldPrice: currentBidAmount,
          auctionStatus: "sold",
          updatedAt: Date.now(),
        }),

        team
          ? ctx.db.patch(currentBidTeamId, {
              purseRemaining: team.purseRemaining - currentBidAmount,
              purseSpent: team.purseSpent + currentBidAmount,
              updatedAt: Date.now(),
            })
          : Promise.resolve(),
      ]);

      // Mark final bid
      const bids = await ctx.db
        .query("bids")
        .withIndex("by_player", (q) => q.eq("playerId", currentPlayerId))
        .order("desc")
        .take(1);

      if (bids.length > 0) {
        await ctx.db.patch(bids[0]._id, { isFinal: true });
      }

      // Create event
      await ctx.db.insert("auctionEvents", {
        auctionRoomId: args.auctionRoomId,
        type: "player_sold",
        data: {
          playerId: currentPlayerId,
          teamId: currentBidTeamId,
          amount: currentBidAmount,
        },
        timestamp: Date.now(),
      });
    } else {
      // Player unsold
      result.sold = false;
      await ctx.db.patch(currentPlayerId, {
        auctionStatus: "unsold",
        updatedAt: Date.now(),
      });

      await ctx.db.insert("auctionEvents", {
        auctionRoomId: args.auctionRoomId,
        type: "player_unsold",
        data: { playerId: currentPlayerId },
        timestamp: Date.now(),
      });
    }

    // Clear current player from auction room
    await ctx.db.patch(args.auctionRoomId, {
      currentPlayerId: undefined,
      currentBidAmount: undefined,
      currentBidTeamId: undefined,
      bidTimerEndsAt: undefined,
      updatedAt: Date.now(),
    });

    return { ...result, success: true };
  },
});

// Start auction for next player
export const startNextPlayer = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    // Check if auction is live
    if (auctionRoom.status !== "live") {
      throw new Error("Auction must be live to get next player");
    }

    // Collect all pending players for this tournament
    let pendingPlayers = await ctx.db
      .query("players")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", auctionRoom.tournamentId),
      )
      .filter((q) => q.eq(q.field("auctionStatus"), "pending"))
      .collect();

    // If no pending players, include unsold or previously in_auction players for re-auction
    if (pendingPlayers.length === 0) {
      pendingPlayers = await ctx.db
        .query("players")
        .withIndex("by_tournament", (q) =>
          q.eq("tournamentId", auctionRoom.tournamentId),
        )
        .filter((q) =>
          q.or(
            q.eq(q.field("auctionStatus"), "unsold"),
            q.eq(q.field("auctionStatus"), "in_auction"),
          ),
        )
        .collect();
    }

    if (pendingPlayers.length === 0) {
      // No more players - complete auction
      await ctx.db.patch(args.auctionRoomId, {
        status: "completed",
        updatedAt: Date.now(),
      });

      await ctx.db.patch(auctionRoom.tournamentId, {
        status: "completed",
        updatedAt: Date.now(),
      });

      return { success: true, completed: true };
    }

    // Pick a random player from the list
    const randomIndex = Math.floor(Math.random() * pendingPlayers.length);
    const nextPlayer = pendingPlayers[randomIndex];

    // Update player status to in_auction
    await ctx.db.patch(nextPlayer._id, {
      auctionStatus: "in_auction",
      updatedAt: Date.now(),
    });

    // Get tournament settings
    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    const bidTimerSeconds = tournament.settings.bidTimerSeconds || 30;

    // Update auction room with the selected player
    await ctx.db.patch(args.auctionRoomId, {
      currentPlayerId: nextPlayer._id,
      currentBidAmount: nextPlayer.basePrice,
      currentBidTeamId: undefined,
      bidTimerEndsAt: Date.now() + bidTimerSeconds * 1000,
      updatedAt: Date.now(),
    });

    return {
      success: true,
      player: nextPlayer,
      remainingPlayers: pendingPlayers.length - 1,
    };
  },
});

// Revert last bid
export const revertLastBid = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (!auctionRoom.currentPlayerId) {
      throw new Error("No player currently in auction");
    }

    // Get all bids for current player
    const bids = await ctx.db
      .query("bids")
      .withIndex("by_player", (q) =>
        q.eq("playerId", auctionRoom.currentPlayerId!),
      )
      .order("desc")
      .collect();

    if (bids.length === 0) {
      throw new Error("No bids to revert");
    }

    // Remove last bid
    const lastBid = bids[0];
    await ctx.db.delete(lastBid._id);

    // Get tournament for timer
    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    // Get player for base price
    const player = await ctx.db.get(auctionRoom.currentPlayerId);
    if (!player) throw new Error("Player not found");

    // If there are previous bids, revert to previous bid
    if (bids.length > 1) {
      const previousBid = bids[1];
      await ctx.db.patch(args.auctionRoomId, {
        currentBidAmount: previousBid.amount,
        currentBidTeamId: previousBid.teamId,
        bidTimerEndsAt: Date.now() + tournament.settings.bidTimerSeconds * 1000,
        updatedAt: Date.now(),
      });
    } else {
      // No previous bids, reset to base price
      await ctx.db.patch(args.auctionRoomId, {
        currentBidAmount: player.basePrice,
        currentBidTeamId: undefined,
        bidTimerEndsAt: Date.now() + tournament.settings.bidTimerSeconds * 1000,
        updatedAt: Date.now(),
      });
    }

    return { success: true };
  },
});

// Query: Get live auction state
export const getLiveAuction = query({
  args: { auctionRoomId: v.id("auctionRooms") },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) return null;

    const [currentPlayer, currentBidTeam, teams, tournament, allPlayers] =
      await Promise.all([
        auctionRoom.currentPlayerId
          ? ctx.db.get(auctionRoom.currentPlayerId)
          : null,
        auctionRoom.currentBidTeamId
          ? ctx.db.get(auctionRoom.currentBidTeamId)
          : null,
        ctx.db
          .query("teams")
          .withIndex("by_tournament", (q) =>
            q.eq("tournamentId", auctionRoom.tournamentId),
          )
          .collect(),
        ctx.db.get(auctionRoom.tournamentId),
        ctx.db
          .query("players")
          .withIndex("by_tournament", (q) =>
            q.eq("tournamentId", auctionRoom.tournamentId),
          )
          .collect(),
      ]);

    // Get recent bids
    let recentBids = [];
    if (auctionRoom.currentPlayerId) {
      recentBids = await ctx.db
        .query("bids")
        .withIndex("by_player", (q) =>
          q.eq("playerId", auctionRoom.currentPlayerId!),
        )
        .order("desc")
        .take(10);
    }

    const pendingCount = allPlayers.filter(
      (p) => p.auctionStatus === "pending",
    ).length;
    const soldCount = allPlayers.filter(
      (p) => p.auctionStatus === "sold",
    ).length;
    const unsoldCount = allPlayers.filter(
      (p) => p.auctionStatus === "unsold",
    ).length;
    const inAuctionCount = allPlayers.filter(
      (p) => p.auctionStatus === "in_auction",
    ).length;

    return {
      auctionRoom,
      currentPlayer,
      currentBidTeam,
      teams,
      recentBids,
      tournament,
      stats: {
        total: allPlayers.length,
        pending: pendingCount,
        sold: soldCount,
        unsold: unsoldCount,
        inAuction: inAuctionCount,
      },
    };
  },
});

export const getAuctionRooms = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("auctionRooms")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .collect();
  },
});
